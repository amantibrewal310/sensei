"use client"

import { useCallback, useRef, useState } from "react"
import { NdjsonActionParser } from "@/lib/ndjson"
import { useDrawRequest } from "@/hooks/useDrawRequest"
import type { VoiceLayer } from "@/voice/types"
import type { Step, TeacherAction } from "@/lib/types"

type Status = "idle" | "planning" | "teaching" | "done"
type Msg = { role: "user" | "assistant"; text: string }

export function useTeachingSession(opts: {
  voice: VoiceLayer | null
  getSvg: () => string
  setSvg: (svg: string) => void
  canvasWidth: number
}) {
  const { voice, getSvg, setSvg, canvasWidth } = opts
  const { draw } = useDrawRequest({ getSvg, setSvg, canvasWidth })

  const [steps, setSteps] = useState<Step[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [status, setStatus] = useState<Status>("idle")
  const transcriptRef = useRef<Msg[]>([])
  const stepsRef = useRef<Step[]>([])
  const indexRef = useRef(0)

  const runTurn = useCallback(async () => {
    setStatus("teaching")
    const res = await fetch("/api/teach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        steps: stepsRef.current,
        currentIndex: indexRef.current,
        transcript: transcriptRef.current,
      }),
    })
    if (!res.body) return

    const parser = new NdjsonActionParser()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    const pending: Promise<unknown>[] = []

    const handleAction = (a: TeacherAction) => {
      if (a.type === "speak") {
        transcriptRef.current.push({ role: "assistant", text: a.text })
        if (voice) pending.push(voice.speak(a.text))
      } else if (a.type === "draw") {
        pending.push(draw(a.instruction))
      }
    }

    const drainSse = (frame: string) => {
      const ev = frame.split("\n").find((l) => l.startsWith("event: "))?.slice(7)
      const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6)
      if (ev === "text" && data) {
        const { delta } = JSON.parse(data)
        for (const a of parser.push(delta)) handleAction(a)
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const frames = buf.split("\n\n")
      buf = frames.pop() ?? ""
      for (const f of frames) drainSse(f)
    }
    for (const a of parser.flush()) handleAction(a)

    await Promise.all(pending)

    // advance
    if (indexRef.current < stepsRef.current.length - 1) {
      indexRef.current += 1
      setCurrentIndex(indexRef.current)
      await runTurn()
    } else {
      setStatus("done")
    }
  }, [voice, draw])

  const start = useCallback(
    async (topic: string) => {
      setStatus("planning")
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      })
      const { steps: planned } = (await res.json()) as { steps: Step[] }
      stepsRef.current = planned
      indexRef.current = 0
      setSteps(planned)
      setCurrentIndex(0)
      await runTurn()
    },
    [runTurn],
  )

  const ask = useCallback(
    (text: string) => {
      voice?.interrupt()
      transcriptRef.current.push({ role: "user", text })
      void runTurn()
    },
    [voice, runTurn],
  )

  return { start, steps, currentIndex, ask, status }
}
