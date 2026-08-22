"use client"

import { Suspense, memo, useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AskForm } from "@/components/AskForm"
import { CaptionDock } from "@/components/CaptionDock"
import { CodePane } from "@/components/CodePane"
import { AlertIcon, BoardIcon } from "@/components/Icons"
import { LessonBar } from "@/components/LessonBar"
import { Outline } from "@/components/Outline"
import { StageHeader } from "@/components/StageHeader"
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

  // Below `lg` the outline is a drawer rather than a rail. A whiteboard being
  // drawn wants the whole window, and 288px of index on a 390px screen leaves
  // it none.
  const [outlineOpen, setOutlineOpen] = useState(false)

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

  /**
   * Closing the drawer puts focus back on the button that opened it. Without
   * this the element holding focus — a step, or the close button — unmounts,
   * focus falls to <body>, and a keyboard user resumes from the top of the
   * document. It no-ops when the drawer is shut, so the page buttons in the
   * stage header do not yank focus to a hamburger nobody pressed.
   */
  const dismissOutline = useCallback(() => {
    if (!outlineOpen) return
    setOutlineOpen(false)
    document.getElementById("outline-toggle")?.focus()
  }, [outlineOpen])

  useEffect(() => {
    if (!outlineOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissOutline()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [outlineOpen, dismissOutline])

  const openOutline = useCallback(() => setOutlineOpen(true), [])

  // Stable identities all the way down: the bar, the outline, the stage header
  // and the caption are all memo'd, and a fresh arrow function here would
  // re-render every one of them on each 90ms code tick.
  const { goTo } = session
  const select = useCallback(
    (index: number) => {
      dismissOutline()
      goTo(index)
    },
    [dismissOutline, goTo],
  )

  const page = session.pages[session.currentIndex]
  // The URL carries the topic when teaching; a replay learns it from the row
  // it read back, and only the hook knows that one.
  const heading = session.topic || topic

  // The rail and the drawer are the same outline at two breakpoints; only the
  // close button differs.
  const outline = {
    topic: heading,
    pages: session.pages,
    currentIndex: session.currentIndex,
    taught: session.taught,
    onSelect: select,
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <LessonBar
        topic={heading}
        status={session.status}
        soundBlocked={session.soundBlocked}
        onEnableSound={session.enableSound}
        onOpenOutline={openOutline}
      />

      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:flex">
          <Outline {...outline} />
        </div>

        {outlineOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Lesson outline"
          >
            <button
              className="absolute inset-0 bg-black/45"
              aria-label="Close the outline"
              onClick={dismissOutline}
            />
            <div className="absolute inset-y-0 left-0 animate-[fadeIn_140ms_ease-out] shadow-float">
              <Outline {...outline} onClose={dismissOutline} />
            </div>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <StageHeader
            page={page}
            index={session.currentIndex}
            total={session.pages.length}
            onSelect={select}
          />

          {/* Stacked on a phone, side by side from `lg`. The board keeps the
              room either way; the code pane takes a fixed slice of what is
              left and only exists while there is code on the page. */}
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="relative flex min-h-0 min-w-0 flex-1 p-2 sm:p-3">
              {/* The board is a canvas: to anything that is not an eye it is
                  one opaque element. The label says what it is, and the
                  caption below carries what it was drawn to illustrate. */}
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

            <CodePane snippets={session.code} />
          </div>

          {/* Distinct from the caption on purpose: the caption is the lesson
              talking, this is the app admitting it broke. `role="alert"` so it
              is announced rather than silently appearing under a canvas nobody
              is reading. */}
          {session.error && (
            <div
              role="alert"
              className="flex shrink-0 items-center justify-center gap-2 border-t border-danger-line bg-danger-soft px-6 py-3 text-center text-sm text-danger"
            >
              <AlertIcon className="h-4 w-4 shrink-0" />
              {session.error}
            </div>
          )}

          <CaptionDock caption={session.caption} spoken={session.spoken} />

          {session.pages.length > 0 && <AskForm onAsk={session.ask} />}
        </main>
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
