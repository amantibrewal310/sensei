"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
  // Each externally-initiated turn (start/ask) bumps `genRef`. A turn captures
  // its generation and bails at every await point once a newer turn supersedes
  // it, so an `ask()` interruption can't leave the old auto-advance loop running
  // in parallel (which would double-advance `indexRef`). `abortRef` stops the
  // superseded turn's in-flight teach fetch promptly.
  const genRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

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
          }),
          signal: controller.signal,
        })
      } catch {
        return // aborted by a newer turn, or network error
      }
      if (gen !== genRef.current || !res.body) return

      const parser = new NdjsonActionParser()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      const pending: Promise<unknown>[] = []

      const handleAction = (a: TeacherAction) => {
        if (gen !== genRef.current) return
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
          for (const f of frames) drainSse(f)
        }
      } catch {
        return // reader aborted by a newer turn
      }
      for (const a of parser.flush()) handleAction(a)

      await Promise.all(pending)
      if (gen !== genRef.current) return // superseded while actions settled

      // advance (recursion keeps the same generation)
      if (indexRef.current < stepsRef.current.length - 1) {
        indexRef.current += 1
        setCurrentIndex(indexRef.current)
        await runTurn(gen)
      } else {
        setStatus("done")
      }
    },
    [voice, draw],
  )

  // Supersede any in-flight turn and begin a fresh one.
  const beginTurn = useCallback(() => {
    genRef.current += 1
    abortRef.current?.abort()
    return runTurn(genRef.current)
  }, [runTurn])

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
      await beginTurn()
    },
    [beginTurn],
  )

  const ask = useCallback(
    (text: string) => {
      voice?.interrupt()
      transcriptRef.current.push({ role: "user", text })
      void beginTurn()
    },
    [voice, beginTurn],
  )

  const askRef = useRef(ask)
  askRef.current = ask
  useEffect(() => {
    voice?.onUserUtterance((t) => askRef.current(t))
  }, [voice])

  return { start, steps, currentIndex, ask, status }
}
