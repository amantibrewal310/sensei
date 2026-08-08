"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { CodePane } from "@/components/CodePane"
import { Outline } from "@/components/Outline"
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
    <div className="flex h-screen bg-neutral-50">
      <Outline
        topic={topic}
        pages={session.pages}
        currentIndex={session.currentIndex}
        taught={session.taught}
        onSelect={session.goTo}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-neutral-200 bg-white">
          <ProgressStrip
            page={session.pages[session.currentIndex]}
            index={session.currentIndex}
            total={session.pages.length}
          />
          {/* Not a "turn voice on" switch — the lesson always narrates. This
              only appears if the browser refused to play audio without a
              gesture, which happens when /learn is opened directly rather than
              reached from the home page. */}
          {session.soundBlocked && (
            <button
              className="m-2 rounded border border-neutral-300 px-3 py-1 text-sm"
              onClick={session.enableSound}
            >
              🔊 Turn on sound
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <Board api={canvas} />
          </div>
          <CodePane snippets={session.code} />
        </div>

        {/* Distinct from the caption on purpose: the caption is the lesson
            talking, this is the app admitting it broke. `role="alert"` so it is
            announced rather than silently appearing under a canvas nobody is
            reading. */}
        {session.error && (
          <div
            role="alert"
            className="border-t border-red-200 bg-red-50 px-6 py-3 text-center text-sm text-red-800"
          >
            {session.error}
          </div>
        )}

        <div className="min-h-16 border-t border-neutral-200 bg-white px-6 py-4">
          <p className="mx-auto max-w-3xl text-center text-lg leading-snug text-neutral-800">
            {session.caption}
          </p>
        </div>

        <form
          className="flex gap-2 border-t border-neutral-200 bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (ask.trim()) {
              session.ask(ask.trim())
              setAsk("")
            }
          }}
        >
          <input
            className="flex-1 rounded border border-neutral-300 p-2"
            placeholder="Ask a question…"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
          />
          <button className="rounded bg-neutral-900 px-4 text-white">Ask</button>
        </form>
      </div>
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
