"use client"

import { memo } from "react"

import Link from "next/link"
import { ArrowLeftIcon, ListIcon, SoundOffIcon } from "@/components/Icons"
import { LogoMark } from "@/components/Logo"
import { ThemeToggle } from "@/components/ThemeToggle"
import type { Status } from "@/hooks/useTeachingSession"

// memo: this sits on the streaming path — a code page repaints every 90ms
// (CODE_LINE_MS) and none of these props change with it.
function LessonBarInner({
  topic,
  status,
  soundBlocked,
  onEnableSound,
  onOpenOutline,
}: {
  topic: string
  status: Status
  soundBlocked: boolean
  onEnableSound: () => void
  onOpenOutline: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
      <button
        type="button"
        id="outline-toggle"
        onClick={onOpenOutline}
        className="btn btn-ghost btn-icon lg:hidden"
        aria-label="Open the lesson outline"
      >
        <ListIcon />
      </button>

      <Link
        href="/"
        className="btn btn-ghost btn-icon"
        aria-label="Leave the lesson and pick another topic"
      >
        <ArrowLeftIcon />
      </Link>

      <span className="hidden lg:block">
        <LogoMark className="h-6 w-6" />
      </span>

      <div className="min-w-0 flex-1 px-1">
        <p className="truncate font-serif text-[15px] leading-tight font-medium">
          {topic || "Planning a lesson…"}
        </p>
      </div>

      <StatusPill status={status} />

      {/* Not a "turn voice on" switch — the lesson always narrates. This only
          appears if the browser refused to play audio without a gesture, which
          happens when /learn is opened directly rather than reached from the
          home page. */}
      {soundBlocked && (
        <button type="button" onClick={onEnableSound} className="btn btn-accent btn-sm">
          <SoundOffIcon />
          <span className="hidden sm:inline">Turn on sound</span>
        </button>
      )}

      <ThemeToggle />
    </header>
  )
}

const LOOK: Record<Status, { label: string; className: string; live: boolean }> = {
  idle: { label: "Ready", className: "badge badge-neutral", live: false },
  planning: { label: "Planning", className: "badge badge-warn", live: true },
  teaching: { label: "Teaching", className: "badge badge-accent", live: true },
  done: { label: "Complete", className: "badge badge-neutral", live: false },
}

/**
 * Not a live region. The caption below is already announcing the lesson
 * sentence by sentence, and a second region competing with it turns both into
 * noise — so this is read on demand, like any other label.
 */
function StatusPill({ status }: { status: Status }) {
  const look = LOOK[status]
  return (
    <span className={`${look.className} shrink-0`}>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full bg-current ${
          look.live ? "animate-[breathe_1.8s_ease-in-out_infinite]" : ""
        }`}
      />
      <span className="hidden sm:inline">{look.label}</span>
    </span>
  )
}

export const LessonBar = memo(LessonBarInner)
