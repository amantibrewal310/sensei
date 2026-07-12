"use client"

import { useCallback, useRef, useState } from "react"
import { NdjsonActionParser } from "@/lib/ndjson"
import type { PanelShape } from "@/lib/shapes"
import { footprintsOf } from "@/lib/pack"
import { Narrator } from "@/lib/narrator"
import type { CanvasApi } from "@/components/Board"
import type { Layout } from "@/lib/layout"
import type { Step, TeacherAction } from "@/lib/types"

type Status = "idle" | "planning" | "teaching" | "done"
type Msg = { role: "user" | "assistant"; text: string }

/** How long a caption holds when there is no audio to pace it. */
function dwell(text: string): number {
  return Math.min(3200, Math.max(900, text.length * 38))
}

const SHAPE_MS = 280 // the pace of the pen
/** A sentence should be underway before its shape appears, not simultaneous with it. */
const LEAD_MS = 450

function wait(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms))
}

type Occupied = { x: number; y: number; w: number; h: number; text: string }

function occupiedBy(shape: PanelShape): Occupied[] {
  return footprintsOf(shape).map((r) => ({
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
    text: r.labelled ? shape.text : "",
  }))
}

export function useTeachingSession(canvas: { current: CanvasApi | null }) {
  const [steps, setSteps] = useState<Step[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [status, setStatus] = useState<Status>("idle")
  const [caption, setCaption] = useState("")
  const [soundBlocked, setSoundBlocked] = useState(false)
  const [narrator] = useState(() => new Narrator())

  // The sentence currently being spoken. Its drawing runs alongside it, but the
  // NEXT sentence waits for it — that is what keeps speech and board in step.
  const speakingRef = useRef<Promise<void>>(Promise.resolve())

  const stepsRef = useRef<Step[]>([])
  const indexRef = useRef(0)
  const boardRef = useRef<Layout | null>(null)
  const transcriptRef = useRef<Msg[]>([])
  // The geometry each panel already holds. Describing past beats in words was
  // not enough — the model needs the actual boxes, or it draws over them.
  const drawnRef = useRef(new Map<string, Occupied[]>())

  const genRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const drawPanel = useCallback(
    async (gen: number, panelId: string, what: string) => {
      const panel = boardRef.current?.panels.find((p) => p.id === panelId)
      if (!panel) return

      const res = await fetch("/api/draw-panel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: panel.title,
          width: panel.rect.width,
          height: panel.rect.height,
          what,
          occupied: drawnRef.current.get(panelId) ?? [],
        }),
      })
      if (!res.body || gen !== genRef.current) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (gen !== genRef.current) {
          await reader.cancel()
          return
        }
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split("\n\n")
        buf = frames.pop() ?? ""
        for (const frame of frames) {
          const ev = frame.split("\n").find((l) => l.startsWith("event: "))?.slice(7)
          const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6)
          // The server has already validated and clamped each shape.
          if (ev === "shape" && data) {
            const shape = JSON.parse(data) as PanelShape
            canvas.current?.addShape(panelId, shape)
            const known = drawnRef.current.get(panelId) ?? []
            drawnRef.current.set(panelId, [...known, ...occupiedBy(shape)])
            await wait(SHAPE_MS) // one shape at a time — this IS the sketching
          }
        }
      }
    },
    [canvas],
  )

  const runTurn = useCallback(
    async (gen: number) => {
      setStatus("teaching")
      const controller = new AbortController()
      abortRef.current = controller

      let res: Response
      try {
        res = await fetch("/api/teach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            steps: stepsRef.current,
            currentIndex: indexRef.current,
            transcript: transcriptRef.current,
            board: boardRef.current,
          }),
          signal: controller.signal,
        })
      } catch {
        return // superseded by a newer turn, or a network error
      }
      if (gen !== genRef.current || !res.body) return

      const parser = new NdjsonActionParser()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""

      // Beats must land in order — a sentence, then the thing it describes.
      // Actions arrive while the teacher is still talking, so they are chained
      // rather than fired off in parallel the way the old loop did it.
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
        } else if (a.type === "draw") {
          if ("panel" in a) await drawPanel(gen, a.panel, a.what)
          else {
            canvas.current?.addConnector(a.connector)
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
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (gen !== genRef.current) {
            await reader.cancel()
            return
          }
          buf += decoder.decode(value, { stream: true })
          const frames = buf.split("\n\n")
          buf = frames.pop() ?? ""
          for (const f of frames) {
            const ev = f.split("\n").find((l) => l.startsWith("event: "))?.slice(7)
            const data = f.split("\n").find((l) => l.startsWith("data: "))?.slice(6)
            if (ev === "text" && data) {
              const { delta } = JSON.parse(data)
              for (const a of parser.push(delta)) enqueue(a)
            }
          }
        }
      } catch {
        return
      }
      for (const a of parser.flush()) enqueue(a)
      await chain
      // The last sentence is still in the air after its shapes have landed.
      // Don't step on it with the next question.
      await speakingRef.current
    },
    [canvas, drawPanel, narrator],
  )

  // Iterating rather than recursing is deliberate. The old loop called itself
  // from inside its own useCallback, so it ran the whole lesson through the
  // closure it was born with — which is why enabling voice mid-lesson never
  // took effect. A loop reads the current refs on every pass.
  const runLesson = useCallback(
    async (gen: number) => {
      for (;;) {
        await runTurn(gen)
        if (gen !== genRef.current) return // superseded by a newer turn
        if (indexRef.current >= stepsRef.current.length - 1) {
          setStatus("done")
          return
        }
        indexRef.current += 1
        setCurrentIndex(indexRef.current)
      }
    },
    [runTurn],
  )

  const beginTurn = useCallback(() => {
    genRef.current += 1
    abortRef.current?.abort()
    return runLesson(genRef.current)
  }, [runLesson])

  const start = useCallback(
    async (topic: string) => {
      setStatus("planning")
      setCaption("Planning the lesson…")

      const planRes = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      })
      const { steps: planned } = (await planRes.json()) as { steps: Step[] }

      setCaption("Designing the board…")
      const boardRes = await fetch("/api/board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic, steps: planned }),
      })
      const board = (await boardRes.json()) as Layout

      stepsRef.current = planned
      indexRef.current = 0
      boardRef.current = board
      drawnRef.current.clear()
      setSteps(planned)
      setCurrentIndex(0)
      canvas.current?.reset(board)

      await beginTurn()
    },
    [beginTurn, canvas],
  )

  const ask = useCallback(
    (text: string) => {
      // The learner has cut in. Stop mid-sentence — carrying on talking over a
      // question is the one thing a tutor must not do.
      narrator.stop()
      speakingRef.current = Promise.resolve()
      transcriptRef.current.push({ role: "user", text })
      void beginTurn()
    },
    [beginTurn, narrator],
  )

  /** Only ever needed if the browser blocked autoplay — see `Narrator.blocked`. */
  const enableSound = useCallback(() => {
    narrator.blocked = false
    setSoundBlocked(false)
  }, [narrator])

  return {
    start,
    ask,
    steps,
    currentIndex,
    status,
    caption,
    soundBlocked,
    enableSound,
  }
}
