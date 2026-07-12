"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { ProgressStrip } from "@/components/ProgressStrip"
import { useTeachingSession } from "@/hooks/useTeachingSession"
import type { CanvasApi } from "@/components/Board"

// tldraw is a browser-only canvas; rendering it on the server just throws.
const Board = dynamic(() => import("@/components/Board").then((m) => m.Board), {
  ssr: false,
})

function LearnInner() {
  const params = useSearchParams()
  const topic = params.get("topic") ?? ""
  const canvas = useRef<CanvasApi | null>(null)
  const startedRef = useRef(false)

  const session = useTeachingSession(canvas)
  const [ask, setAsk] = useState("")

  useEffect(() => {
    if (topic && !startedRef.current) {
      startedRef.current = true
      void session.start(topic)
    }
  }, [topic, session])

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <div className="flex items-center justify-between border-b bg-white">
        <ProgressStrip
          current={session.currentIndex}
          total={session.steps.length}
          label={session.steps[session.currentIndex]?.label}
        />
        {/* Not a "turn voice on" switch — the lesson always narrates. This only
            appears if the browser refused to play audio without a gesture,
            which happens when /learn is opened directly rather than from home. */}
        {session.soundBlocked && (
          <button
            className="m-2 rounded border px-3 py-1 text-sm"
            onClick={session.enableSound}
          >
            🔊 Turn on sound
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <Board api={canvas} />
      </div>

      {/* Phase 1 stands in for the narration: you read the sentence that the
          shape appearing beside it is answering. Phase 2 speaks this instead. */}
      <div className="min-h-16 border-t bg-white px-6 py-4">
        <p className="mx-auto max-w-3xl text-center text-lg leading-snug text-neutral-800">
          {session.caption}
        </p>
      </div>

      <form
        className="flex gap-2 border-t bg-white p-3"
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
