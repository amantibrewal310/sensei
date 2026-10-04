"use client"

import { Suspense, memo, useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AlertIcon, BoardIcon } from "@/components/Icons"
import { LessonBar } from "@/components/LessonBar"
import { LessonStream } from "@/components/LessonStream"
import { useTeachingSession } from "@/hooks/useTeachingSession"
import type { CanvasApi } from "@/components/Board"

// tldraw is a browser-only canvas; rendering it on the server just throws.
// memo because its one prop is a stable ref object: without it, every caption
// change and 90ms code tick re-rendered tldraw's root along with the page.
const Board = memo(
  dynamic(() => import("@/components/Board").then((m) => m.Board), {
    ssr: false,
  }),
)

function LearnInner() {
  const params = useSearchParams()
  const topic = params.get("topic") ?? ""
  // ?lesson=<id> replays a stored lesson instead of teaching a new one: same
  // page, same canvas, no call to Anthropic.
  const lesson = params.get("lesson") ?? ""
  const canvas = useRef<CanvasApi | null>(null)
  const startedRef = useRef(false)

  const session = useTeachingSession(canvas)

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

  const page = session.pages[session.currentIndex]
  // The URL carries the topic when teaching; a replay learns it from the row
  // it read back, and only the hook knows that one.
  const heading = session.topic || topic

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <LessonBar
        topic={heading}
        status={session.status}
        soundBlocked={session.soundBlocked}
        onEnableSound={session.enableSound}
        pages={session.pages}
        currentIndex={session.currentIndex}
        taught={session.taught}
        onSelect={session.goTo}
      />

      {/* The board and the teacher's side of the desk: side by side from
          `lg`, the stream stacked under the board below it. Nothing else
          gets a column — the outline is in the header and code is a beat in
          the stream — so the board keeps the room. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2 sm:p-3 lg:pr-0">
          <div className="relative flex min-h-0 min-w-0 flex-1">
            {/* The board is a canvas: to anything that is not an eye it is
                one opaque element. The label says what it is, and the stream
                beside it carries what it was drawn to illustrate. */}
            <div
              className="board-surface relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-board shadow-soft"
              role="img"
              aria-label={`Whiteboard for “${page?.title ?? "the lesson"}”`}
            >
              <Board api={canvas} />
            </div>

            {/* Sibling of the canvas, not a child of it: a link inside
                role="img" is a link no assistive technology will offer. */}
            {!topic && !lesson && <NothingToTeach />}
          </div>

          {/* Distinct from the stream on purpose: the stream is the lesson
              talking, this is the app admitting it broke. `role="alert"` so
              it is announced rather than silently appearing under a canvas
              nobody is reading. */}
          {session.error && (
            <div
              role="alert"
              className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-danger-line bg-danger-soft px-4 py-2.5 text-center text-sm text-danger"
            >
              <AlertIcon className="h-4 w-4 shrink-0" />
              {session.error}
            </div>
          )}
        </main>

        <LessonStream
          pages={session.pages}
          currentIndex={session.currentIndex}
          taught={session.taught}
          stream={session.stream}
          live={session.live}
          caption={session.caption}
          onAsk={session.ask}
        />
      </div>
    </div>
  )
}

/** /learn opened with no topic and no lesson — a blank board and no explanation. */
function NothingToTeach() {
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="max-w-xs text-center">
        <BoardIcon className="mx-auto h-7 w-7 text-faint" />
        <p className="mt-3 font-serif text-lg font-medium">An empty board</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted text-pretty">
          Nothing is being taught here yet. Lessons start from a topic.
        </p>
        <Link href="/" className="btn btn-primary mt-4">
          Pick a topic
        </Link>
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
