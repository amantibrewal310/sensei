"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { SvgCanvas } from "@/components/SvgCanvas"
import { ProgressStrip } from "@/components/ProgressStrip"
import { useTeachingSession } from "@/hooks/useTeachingSession"
import { createRealtimeVoice } from "@/voice/realtime"
import type { VoiceLayer } from "@/voice/types"

const START =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="100%" height="100%"></svg>'

function LearnInner() {
  const params = useSearchParams()
  const topic = params.get("topic") ?? ""
  const [svg, setSvg] = useState(START)
  const svgRef = useRef(svg)
  svgRef.current = svg
  const [voice, setVoice] = useState<VoiceLayer | null>(null)
  const [ask, setAsk] = useState("")
  const startedRef = useRef(false)

  const session = useTeachingSession({
    voice,
    getSvg: () => svgRef.current,
    setSvg,
    canvasWidth: 800,
  })

  useEffect(() => {
    if (topic && !startedRef.current) {
      startedRef.current = true
      void session.start(topic)
    }
  }, [topic, session])

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center justify-between border-b">
        <ProgressStrip
          current={session.currentIndex}
          total={session.steps.length}
          label={session.steps[session.currentIndex]?.label}
        />
        {!voice && (
          <button
            className="m-2 rounded border px-3 py-1 text-sm"
            onClick={async () => setVoice(await createRealtimeVoice())}
          >
            Start voice
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <SvgCanvas svg={svg} />
      </div>
      <form
        className="flex gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (ask.trim()) {
            session.ask(ask.trim())
            setAsk("")
          }
        }}
      >
        <input
          className="flex-1 rounded border p-2"
          placeholder="Ask a question…"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <button className="rounded bg-black px-4 text-white">Ask</button>
      </form>
    </div>
  )
}

export default function Learn() {
  return (
    <Suspense>
      <LearnInner />
    </Suspense>
  )
}
