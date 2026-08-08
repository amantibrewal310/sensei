"use client"

import { useCallback, useRef, useState } from "react"
import { LineParser, parseAction } from "@/lib/ndjson"
import { readSse } from "@/lib/sse"
import { Narrator } from "@/lib/narrator"
import type { CanvasApi } from "@/components/Board"
import type { Block } from "@/lib/blocks"
import type { Board } from "@/lib/board"
import type { Snippet } from "@/lib/code"
import { TRANSCRIPT_WINDOW, type Page } from "@/lib/lesson"
import { layoutBoard, panelById, type Layout } from "@/lib/layout"
import { renderPanel } from "@/lib/render"
import type { TeacherAction } from "@/lib/types"

type Status = "idle" | "planning" | "teaching" | "done"
export type Msg = { role: "user" | "assistant"; text: string }

/**
 * Adds a message to the transcript, dropping the oldest to stay inside
 * `TRANSCRIPT_WINDOW`.
 *
 * Trimmed as it is written rather than as it is sent: the array is then bounded
 * everywhere it is read, instead of every future reader having to remember to
 * bound it. Oldest-first is what keeps the learner's latest question — always
 * the message pushed most recently — from being the one thrown away.
 */
export function remember(transcript: Msg[], msg: Msg): void {
  transcript.push(msg)
  if (transcript.length > TRANSCRIPT_WINDOW) {
    transcript.splice(0, transcript.length - TRANSCRIPT_WINDOW)
  }
}

/**
 * What one turn has left of its `/api/draw-panel` allowance. Mutable, and shared
 * by every beat of that turn.
 */
interface Beats {
  left: number
}

/**
 * The most drawing calls one teaching turn may make.
 *
 * `TEACHER_SYSTEM` asks for four to seven spoken lines with one drawing apiece,
 * and a measured page came back with six — so this is about twice what a turn
 * that follows its instructions needs. It is here for the turn that does not: a
 * model that keeps emitting draw beats spends an Opus call on each, and this is
 * the only thing in the client that says when to stop.
 */
const MAX_PANEL_BEATS = 12

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
 * The message a route sent with a non-2xx, falling back to `fallback`.
 *
 * Every route answers a failure with `{error}`, but a proxy timing out or a
 * crash upstream answers with HTML or nothing at all — so reading the body must
 * not itself be able to throw and turn a handled failure into an unhandled one.
 */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === "string" ? body.error : fallback
  } catch {
    return fallback
  }
}

/** Reads the `{message}` payload `sseResponse` sends on its `error` frame. */
function messageFromErrorFrame(data: string, fallback: string): string {
  try {
    const body = JSON.parse(data) as { message?: unknown }
    return typeof body.message === "string" && body.message
      ? body.message
      : fallback
  } catch {
    return fallback
  }
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
  // The caption is replaced by the next sentence, so on its own it is a lesson
  // you cannot look back at. This is the same text kept, and it is what makes
  // the spoken half of the lesson readable rather than merely audible.
  const [spoken, setSpoken] = useState<string[]>([])
  // Separate from `caption`, which is the lesson talking. This is the app
  // admitting something went wrong, and it must not be overwritten by the next
  // sentence the teacher happens to emit.
  const [error, setError] = useState<string | null>(null)
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

      let res: Response
      try {
        res = await fetch("/api/board", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic: topicRef.current, page }),
        })
      } catch {
        // Offline, DNS, or a dropped connection. Unlike a superseded turn this
        // is a real failure, and the learner is owed an explanation.
        if (gen === genRef.current) {
          setError(`Couldn't reach the server to set up “${page.title}”.`)
        }
        return null
      }
      if (gen !== genRef.current) return null

      if (!res.ok) {
        setError(await errorFrom(res, `Couldn't set up “${page.title}”.`))
        return null
      }

      let board: Board
      try {
        board = (await res.json()) as Board
      } catch {
        setError(`The board for “${page.title}” came back malformed.`)
        return null
      }
      if (!board?.panels?.length) {
        setError(`The board for “${page.title}” came back empty.`)
        return null
      }

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
    async (
      gen: number,
      page: Page,
      state: PageState,
      beats: Beats,
      panelId: string,
      what: string,
    ) => {
      const panel = panelById(state.layout, panelId)
      if (!panel) return

      // Said out loud rather than quietly skipped. A board that stops filling in
      // with no explanation is the same silent failure the `!res.ok` check below
      // exists to prevent — and if this ever trips in front of anyone, the
      // reason should be on screen and not in a log.
      if (beats.left <= 0) {
        setError(
          `“${page.title}” asked for more than ${MAX_PANEL_BEATS} drawings, so the rest were skipped.`,
        )
        return
      }
      beats.left -= 1

      canvas.current?.focus(page.id, state.layout, panelId)

      let res: Response
      try {
        res = await fetch("/api/draw-panel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: panel.title,
            note: panel.note,
            what,
            existing: state.content.get(panelId) ?? [],
          }),
        })
      } catch {
        if (gen === genRef.current) setError("Lost the connection mid-drawing.")
        return
      }
      if (gen !== genRef.current) return

      // An error response still has a body, so without this check `readSse`
      // below happily iterates the JSON error, finds no SSE frames, yields
      // nothing, and the turn returns as though the panel had been drawn — the
      // page then gets marked taught with an empty panel and nothing anywhere
      // says why. Silent success is worse than a visible failure.
      if (!res.ok) {
        setError(await errorFrom(res, `Couldn't draw into “${panel.title}”.`))
        return
      }
      if (!res.body) {
        setError(`Couldn't draw into “${panel.title}” — empty response.`)
        return
      }

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
        // `sseResponse` turns a mid-stream throw into this frame. Nothing read
        // it before, so a stream that died halfway left a half-drawn panel and
        // no explanation.
        else if (event === "error") {
          setError(messageFromErrorFrame(data, "The drawing stream failed."))
          return
        }
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

      // Per turn, not per page. Asking a question re-teaches the page, and a
      // learner three questions in should not find that the board has quietly
      // stopped drawing because an earlier pass spent the page's allowance.
      const beats: Beats = { left: MAX_PANEL_BEATS }

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
        // `cancel()` aborts this fetch whenever the learner moves on, and that
        // is not a failure. A throw while this turn is still the current one is.
        if (gen === genRef.current) setError("Couldn't reach the teacher.")
        return
      }
      if (gen !== genRef.current) return

      if (!res.ok) {
        setError(await errorFrom(res, "The teacher couldn't start this page."))
        return
      }
      if (!res.body) {
        setError("The teacher returned an empty response.")
        return
      }

      const parser = new LineParser(parseAction)

      // Beats must land in order — a sentence, then the thing it describes.
      // Actions arrive while the teacher is still talking, so they are chained
      // rather than fired off in parallel.
      let chain: Promise<void> = Promise.resolve()

      const handle = async (a: TeacherAction) => {
        if (gen !== genRef.current) return
        if (a.type === "speak") {
          remember(transcriptRef.current, { role: "assistant", text: a.text })
          // Let the previous sentence land before starting this one.
          await speakingRef.current
          if (gen !== genRef.current) return

          setCaption(a.text)
          setSpoken((lines) => [...lines, a.text].slice(-TRANSCRIPT_WINDOW))
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
          if ("panel" in a) await drawPanel(gen, page, state, beats, a.panel, a.what)
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
          } else if (event === "error") {
            setError(messageFromErrorFrame(data, "The lesson stream failed."))
            return
          }
        }
      } catch {
        if (gen === genRef.current) setError("The lesson stream broke.")
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
    // A new run is the learner's answer to whatever went wrong last time.
    setError(null)
    return runFrom(genRef.current)
  }, [cancel, runFrom])

  const start = useCallback(
    async (topic: string) => {
      setStatus("planning")
      setCaption("Planning the lesson…")
      setError(null)
      topicRef.current = topic

      // This fetch used to be unwrapped, so going offline rejected inside a
      // form handler and surfaced as an unhandled promise rejection rather than
      // as anything the learner could see.
      let res: Response
      try {
        res = await fetch("/api/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic }),
        })
      } catch {
        setStatus("idle")
        setError("Couldn't reach the server. Check your connection.")
        return
      }

      if (!res.ok) {
        setStatus("idle")
        setError(await errorFrom(res, "Couldn't plan that lesson."))
        return
      }

      let planned: Page[] | undefined
      try {
        ;({ pages: planned } = (await res.json()) as { pages: Page[] })
      } catch {
        setStatus("idle")
        setError("The lesson plan came back malformed.")
        return
      }
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
      setSpoken([])

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
      remember(transcriptRef.current, { role: "user", text })
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
    spoken,
    error,
    soundBlocked,
    enableSound,
    code: code[pages[currentIndex]?.id ?? ""] ?? [],
  }
}
