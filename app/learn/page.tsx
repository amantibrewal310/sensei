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
  // ?lesson=<id> replays a stored lesson instead of teaching a new one: same
  // page, same canvas, no call to Anthropic.
  const lesson = params.get("lesson") ?? ""
  const canvas = useRef<CanvasApi | null>(null)
  const startedRef = useRef(false)

  const session = useTeachingSession(canvas)
  const [ask, setAsk] = useState("")

  useEffect(() => {
    if (startedRef.current) return
    if (lesson) {
      startedRef.current = true
      void session.replay(lesson)
    } else if (topic) {
      startedRef.current = true
      void session.start(topic)
    }
  }, [lesson, topic, session])

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
          {/* The board is a canvas: to anything that is not an eye it is one
              opaque element. The label says what it is, and the transcript
              below carries what it was drawn to illustrate. */}
          <div
            className="relative min-w-0 flex-1"
            role="img"
            aria-label={`Whiteboard for “${session.pages[session.currentIndex]?.title ?? "the lesson"}”`}
          >
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
          {/* The lesson is audio and canvas, so this line is the only part of
              it a screen reader can reach. `polite` rather than `assertive`:
              sentences arrive every few seconds and interrupting the reader
              each time would make it unusable. */}
          <p
            role="status"
            aria-live="polite"
            className="mx-auto max-w-3xl text-center text-lg leading-snug text-neutral-800"
          >
            {session.caption}
          </p>

          {/* Closed by default — the lesson is meant to be watched. Open, it
              answers "what did it just say", which is the same question a
              screen reader user has and a distracted one does too. `summary`
              is focusable on its own, so this needs no keyboard handling. */}
          {session.spoken.length > 0 && (
            <details className="mx-auto mt-2 max-w-3xl text-sm text-neutral-500">
              <summary className="cursor-pointer text-center">
                What was said ({session.spoken.length})
              </summary>
              <ol className="mt-2 space-y-1">
                {session.spoken.map((line, i) => (
                  <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
                ))}
              </ol>
            </details>
          )}
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
          {/* A placeholder is not a label: it disappears the moment anyone
              types, and it is not what a screen reader announces the field by. */}
          <label className="sr-only" htmlFor="ask">
            Ask a question about this page
          </label>
          <input
            id="ask"
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
