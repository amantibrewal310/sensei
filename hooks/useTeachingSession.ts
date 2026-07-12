"use client"

import { useCallback, useRef, useState } from "react"
import { NdjsonActionParser } from "@/lib/ndjson"
import type { PanelShape } from "@/lib/shapes"
import { footprintsOf } from "@/lib/pack"
import type { CanvasApi } from "@/components/Board"
import type { Layout } from "@/lib/layout"
import type { Step, TeacherAction } from "@/lib/types"

type Status = "idle" | "planning" | "teaching" | "done"
type Msg = { role: "user" | "assistant"; text: string }

/** How long a caption holds before the next beat. Phase 2 replaces this with the speech's own duration. */
function dwell(text: string): number {
  return Math.min(3200, Math.max(900, text.length * 38))
}

const SHAPE_MS = 280 // the pace of the pen

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
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
          setCaption(a.text)
          await wait(dwell(a.text))
        } else if (a.type === "draw") {
          if ("panel" in a) await drawPanel(gen, a.panel, a.what)
          else {
            canvas.current?.addConnector(a.connector)
            await wait(SHAPE_MS * 2)
          }
        }
      }

      const enqueue = (a: TeacherAction) => {
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
    },
    [canvas, drawPanel],
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
      transcriptRef.current.push({ role: "user", text })
      void beginTurn()
    },
    [beginTurn],
  )

  return { start, ask, steps, currentIndex, status, caption }
}
