"use client"

import { useCallback, useRef, useState } from "react"
import { LineParser, parseAction } from "@/lib/ndjson"
import { readSse } from "@/lib/sse"
import { Narrator } from "@/lib/narrator"
import type { CanvasApi } from "@/components/Board"
import type { Block } from "@/lib/blocks"
import type { Board } from "@/lib/board"
import type { Snippet } from "@/lib/code"
import type { Page } from "@/lib/lesson"
import { layoutBoard, panelById, type Layout } from "@/lib/layout"
import { renderPanel } from "@/lib/render"
import type { TeacherAction } from "@/lib/types"

type Status = "idle" | "planning" | "teaching" | "done"
type Msg = { role: "user" | "assistant"; text: string }

/** How long a caption holds when there is no audio to pace it. */
function dwell(text: string): number {
  return Math.min(3200, Math.max(900, text.length * 38))
}

const SHAPE_MS = 240 // the pace of the pen
/** A sentence should be underway before its shape appears, not simultaneous with it. */
const LEAD_MS = 450
/** Code types out faster than the pen draws — it is read, not watched. */
const CODE_LINE_MS = 90

function wait(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * One page's canvas: the board it was given, what has been drawn into each
 * panel, and the layout those two produce. The blocks are the source of truth —
 * the layout is recomputed from them every time a panel grows.
 */
interface PageState {
  board: Board
  content: Map<string, Block[]>
  layout: Layout
}

export function useTeachingSession(canvas: { current: CanvasApi | null }) {
  const [pages, setPages] = useState<Page[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [taught, setTaught] = useState<string[]>([])
  // Snippets per page, so navigating back to "Token bucket" brings its code
  // with it exactly as its diagram comes back.
  const [code, setCode] = useState<Record<string, Snippet[]>>({})
  const [status, setStatus] = useState<Status>("idle")
  const [caption, setCaption] = useState("")
  const [soundBlocked, setSoundBlocked] = useState(false)
  const [narrator] = useState(() => new Narrator())

  // The sentence currently being spoken. Its drawing runs alongside it, but the
  // NEXT sentence waits for it — that is what keeps speech and board in step.
  const speakingRef = useRef<Promise<void>>(Promise.resolve())

  const topicRef = useRef("")
  const pagesRef = useRef<Page[]>([])
  const indexRef = useRef(0)
  const stateRef = useRef(new Map<string, PageState>())
  const transcriptRef = useRef<Msg[]>([])

  const genRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  /** Fetches this page's board the first time it is visited, and shows it. */
  const openPage = useCallback(
    async (gen: number, page: Page): Promise<PageState | null> => {
      const existing = stateRef.current.get(page.id)
      if (existing) {
        canvas.current?.openPage(page.id, page.title, existing.layout)
        return existing
      }

      setCaption(`Setting up “${page.title}”…`)
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: topicRef.current, page }),
      })
      if (gen !== genRef.current) return null
      const board = (await res.json()) as Board
      if (!board?.panels?.length) return null

      const state: PageState = {
        board,
        content: new Map(),
        layout: layoutBoard(board),
      }
      stateRef.current.set(page.id, state)
      canvas.current?.openPage(page.id, page.title, state.layout)
      return state
    },
    [canvas],
  )

  const drawPanel = useCallback(
    async (gen: number, page: Page, state: PageState, panelId: string, what: string) => {
      const panel = panelById(state.layout, panelId)
      if (!panel) return
      canvas.current?.focus(page.id, state.layout, panelId)

      const res = await fetch("/api/draw-panel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: panel.title,
          note: panel.note,
          what,
          existing: state.content.get(panelId) ?? [],
        }),
      })
      if (!res.body || gen !== genRef.current) return

      const draw = async (block: Block) => {
        const blocks = [...(state.content.get(panelId) ?? []), block]
        state.content.set(panelId, blocks)

        // The panel now holds more than it did, so the whole board is re-laid
        // out: this panel grows, and its column grows with it if it must. The
        // panel is never smaller than its contents, which is why nothing here
        // can overflow or be dropped.
        state.layout = layoutBoard(state.board, state.content)
        canvas.current?.applyLayout(page.id, state.layout)

        const { shapes, starts } = renderPanel(blocks)
        const from = starts[starts.length - 1]

        // Everything already on the board may have shifted when the panel grew,
        // so it is re-placed ONCE here. The reveal below then only ever adds the
        // next shape, instead of rewriting the whole panel on every tick.
        canvas.current?.syncPanel(page.id, state.layout, panelId, shapes, from, 0)

        for (let i = from; i < shapes.length; i++) {
          if (gen !== genRef.current) return
          canvas.current?.syncPanel(page.id, state.layout, panelId, shapes, i + 1, i)
          await wait(SHAPE_MS) // one shape at a time — this IS the sketching
        }
        canvas.current?.focus(page.id, state.layout, panelId)
      }

      for await (const { event, data } of readSse(
        res.body,
        () => gen === genRef.current,
      )) {
        // The server has already validated and normalised each block.
        if (event === "block") await draw(JSON.parse(data) as Block)
      }
    },
    [canvas],
  )

  /** Types a snippet into the pane a line at a time. */
  const showCode = useCallback(
    async (gen: number, page: Page, label: string, lines: string[]) => {
      const id = `${page.id}~${label}`
      // How snippets are keyed by page is stated once, here, rather than being
      // restated by every updater that touches the map.
      const patch = (fn: (list: Snippet[]) => Snippet[]) =>
        setCode((all) => ({ ...all, [page.id]: fn(all[page.id] ?? []) }))

      // Keyed by label so re-teaching a page after a question replaces its
      // snippet rather than stacking a second copy underneath.
      patch((list) => [
        ...list.filter((s) => s.id !== id),
        { id, label, lines: [] },
      ])

      for (const line of lines) {
        if (gen !== genRef.current) return
        patch((list) =>
          list.map((s) => (s.id === id ? { ...s, lines: [...s.lines, line] } : s)),
        )
        await wait(CODE_LINE_MS)
      }
    },
    [],
  )

  const runTurn = useCallback(
    async (gen: number, page: Page, state: PageState) => {
      setStatus("teaching")
      const controller = new AbortController()
      abortRef.current = controller

      let res: Response
      try {
        res = await fetch("/api/teach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            topic: topicRef.current,
            pages: pagesRef.current,
            currentIndex: indexRef.current,
            transcript: transcriptRef.current,
            board: state.board,
          }),
          signal: controller.signal,
        })
      } catch {
        return // superseded by a newer turn, or a network error
      }
      if (gen !== genRef.current || !res.body) return

      const parser = new LineParser(parseAction)

      // Beats must land in order — a sentence, then the thing it describes.
      // Actions arrive while the teacher is still talking, so they are chained
      // rather than fired off in parallel.
      let chain: Promise<void> = Promise.resolve()

      const handle = async (a: TeacherAction) => {
        if (gen !== genRef.current) return
        if (a.type === "speak") {
          transcriptRef.current.push({ role: "assistant", text: a.text })
          // Let the previous sentence land before starting this one.
          await speakingRef.current
          if (gen !== genRef.current) return

          setCaption(a.text)
          // Deliberately NOT awaited: the drawing for this sentence should
          // happen while it is being said, not after it.
          speakingRef.current = narrator.speak(a.text).then(() => {
            // With audio blocked there is nothing to pace the lesson, so fall
            // back to holding the caption long enough to read.
            if (narrator.blocked) {
              setSoundBlocked(true)
              return wait(dwell(a.text))
            }
          })
          await wait(LEAD_MS)
        } else if (a.type === "code") {
          await showCode(gen, page, a.label, a.lines)
        } else if (a.type === "draw") {
          if ("panel" in a) await drawPanel(gen, page, state, a.panel, a.what)
          else {
            canvas.current?.addConnector(page.id, state.layout, a.connector)
            await wait(SHAPE_MS * 2)
          }
        }
      }

      const enqueue = (a: TeacherAction) => {
        // Synthesis costs about a second. Start it the moment the line is
        // parsed — several beats before it is due — so it is ready to play.
        if (a.type === "speak") narrator.prefetch(a.text)
        chain = chain.then(() => handle(a))
      }

      try {
        for await (const { event, data } of readSse(
          res.body,
          () => gen === genRef.current,
        )) {
          if (event === "text") {
            const { delta } = JSON.parse(data)
            for (const a of parser.push(delta)) enqueue(a)
          }
        }
      } catch {
        return
      }
      for (const a of parser.flush()) enqueue(a)
      await chain
      // The last sentence is still in the air after its shapes have landed.
      // Don't step on it with the next page.
      await speakingRef.current
      if (gen !== genRef.current) return

      setTaught((t) => (t.includes(page.id) ? t : [...t, page.id]))
      canvas.current?.fitAll()
    },
    [canvas, drawPanel, narrator, showCode],
  )

  // The index the async loop reads and the index the UI renders are the same
  // number, so they move together in one place rather than being paired up by
  // hand at each of the three sites that advance the lesson.
  const setIndex = useCallback((index: number) => {
    indexRef.current = index
    setCurrentIndex(index)
  }, [])

  // Iterating rather than recursing is deliberate. The old loop called itself
  // from inside its own useCallback, so it ran the whole lesson through the
  // closure it was born with — which is why enabling voice mid-lesson never
  // took effect. A loop reads the current refs on every pass.
  const runFrom = useCallback(
    async (gen: number) => {
      for (;;) {
        const page = pagesRef.current[indexRef.current]
        if (!page) return
        const state = await openPage(gen, page)
        if (gen !== genRef.current) return
        if (state) await runTurn(gen, page, state)
        if (gen !== genRef.current) return

        if (indexRef.current >= pagesRef.current.length - 1) {
          setStatus("done")
          setCaption("That's the lesson. Pick any page from the outline to revisit it.")
          return
        }
        setIndex(indexRef.current + 1)
      }
    },
    [openPage, runTurn, setIndex],
  )

  /**
   * Everything a new generation means, in one place: nothing in flight may
   * touch the board again, and the teacher stops mid-sentence. Spelled out at
   * each call site, one of the four steps was always the one to be forgotten.
   */
  const cancel = useCallback(() => {
    genRef.current += 1
    abortRef.current?.abort()
    narrator.stop()
    speakingRef.current = Promise.resolve()
  }, [narrator])

  /** Cancels whatever is in flight and starts a new run from `indexRef`. */
  const begin = useCallback(() => {
    cancel()
    return runFrom(genRef.current)
  }, [cancel, runFrom])

  const start = useCallback(
    async (topic: string) => {
      setStatus("planning")
      setCaption("Planning the lesson…")
      topicRef.current = topic

      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      })
      const { pages: planned } = (await res.json()) as { pages: Page[] }
      if (!planned?.length) {
        setStatus("idle")
        setCaption("Couldn't plan that lesson. Try another topic.")
        return
      }

      pagesRef.current = planned
      stateRef.current.clear()
      transcriptRef.current = []
      setPages(planned)
      setIndex(0)
      setTaught([])
      setCode({})

      await begin()
    },
    [begin, setIndex],
  )

  /**
   * Jump to any page in the outline. A page already taught is simply shown
   * again — its canvas is still there, which is the point of pages.
   */
  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= pagesRef.current.length) return
      setIndex(index)

      const page = pagesRef.current[index]
      const state = stateRef.current.get(page.id)
      if (state && taught.includes(page.id)) {
        cancel()
        canvas.current?.openPage(page.id, page.title, state.layout)
        setStatus("done")
        setCaption(page.summary)
        return
      }
      void begin()
    },
    [begin, cancel, canvas, setIndex, taught],
  )

  const ask = useCallback(
    (text: string) => {
      // The learner has cut in. `begin` stops the teacher mid-sentence —
      // carrying on talking over a question is the one thing a tutor must not
      // do — and re-runs this page with the question in the transcript.
      transcriptRef.current.push({ role: "user", text })
      void begin()
    },
    [begin],
  )

  /** Only ever needed if the browser blocked autoplay — see `Narrator.blocked`. */
  const enableSound = useCallback(() => {
    narrator.blocked = false
    setSoundBlocked(false)
  }, [narrator])

  return {
    start,
    ask,
    goTo,
    pages,
    currentIndex,
    taught,
    status,
    caption,
    soundBlocked,
    enableSound,
    code: code[pages[currentIndex]?.id ?? ""] ?? [],
  }
}
