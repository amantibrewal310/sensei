"use client"

import { useLayoutEffect, useRef } from "react"

import { AskForm } from "@/components/AskForm"
import { CodeCard } from "@/components/CodeCard"
import { CheckIcon, ChevronDownIcon } from "@/components/Icons"
import type { Entry } from "@/hooks/useTeachingSession"
import { PAGE_KIND, type Page } from "@/lib/lesson"

const NOTHING: Entry[] = []

/**
 * The teacher's side of the desk: the page's question, then everything said
 * and shown on it in the order it happened, with the sentence being spoken
 * set largest. Code is a beat like a sentence, so it sits under the sentence
 * that introduced it instead of in a column of its own.
 *
 * Anchored to the bottom, like a conversation: the newest thing is always
 * nearest the ask box, which is where the learner's eye already is when they
 * want to interrupt.
 */
export function LessonStream({
  pages,
  currentIndex,
  taught,
  stream,
  live,
  caption,
  onAsk,
}: {
  pages: Page[]
  currentIndex: number
  taught: string[]
  stream: Record<string, Entry[]>
  live: string | null
  caption: string
  onAsk: (text: string) => void
}) {
  const page = pages[currentIndex]
  const entries = (page && stream[page.id]) || NOTHING
  const previous = pages[currentIndex - 1]
  const previousEntries = (previous && stream[previous.id]) || NOTHING

  // The caption is also the app talking — "Planning the lesson…", a revisited
  // page's summary, the end of the lesson. Those are not in the stream, so
  // they get a line of their own while nothing is being spoken.
  const lastSaid = entries.findLast((e) => e.kind === "say")
  const notice = !live && caption && caption !== lastSaid?.text ? caption : ""

  const scroller = useRef<HTMLDivElement>(null)
  // Follows the stream down only while the learner is at the bottom of it. A
  // learner scrolled up to re-read something must not be yanked away from it
  // by the next sentence.
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [entries, notice])

  return (
    <aside
      aria-label="What the teacher has said"
      className="flex max-h-[42vh] min-h-0 shrink-0 flex-col border-t border-line lg:max-h-none lg:w-[28.5rem] lg:border-t-0"
    >
      {/* The only live region on the page. Visually the stream already shows
          this sentence; this is what reads it out, once, as it lands. */}
      <p className="sr-only" role="status" aria-live="polite">
        {caption}
      </p>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
        className="scroll-slim flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3 lg:px-5 lg:pt-4"
      >
        {previous && previousEntries.length > 0 && (
          <Fold
            index={currentIndex - 1}
            page={previous}
            entries={previousEntries}
            taught={taught.includes(previous.id)}
          />
        )}

        {page && (
          <header className="border-b border-line pb-3">
            <p className="eyebrow">
              Page {currentIndex + 1}
              {PAGE_KIND[page.kind].badge && ` · ${PAGE_KIND[page.kind].badge}`}
            </p>
            <h2 className="mt-1.5 font-serif text-[18px] leading-snug font-medium text-pretty">
              {page.question}
            </h2>
          </header>
        )}

        {/* Pushes a short stream to the bottom, and collapses to nothing once
            the stream is taller than the rail. */}
        <div className="min-h-4 flex-1" />

        <ol className="flex flex-col gap-4 pb-1">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Beat entry={entry} live={entry.id === live} />
            </li>
          ))}
        </ol>

        {notice && (
          <p className="pt-4 pb-1 font-serif text-[17px] leading-relaxed text-muted text-pretty">
            {notice}
          </p>
        )}
      </div>

      {pages.length > 0 && <AskForm onAsk={onAsk} />}
    </aside>
  )
}

function Beat({ entry, live }: { entry: Entry; live: boolean }) {
  if (entry.kind === "code") return <CodeCard snippet={entry} />

  if (entry.kind === "ask") {
    return (
      <div className="rounded-lg border border-line-strong bg-surface px-3.5 py-2.5">
        <p className="eyebrow">You asked</p>
        <p className="mt-1 text-[14.5px] leading-relaxed">{entry.text}</p>
      </div>
    )
  }

  // The voice is the largest thing in the rail, in the serif; once the next
  // sentence starts it steps back into the sans, so the eye always finds the
  // one being said without reading the ones that were.
  return live ? (
    <div className="flex gap-3.5">
      <span aria-hidden="true" className="w-[3px] shrink-0 rounded-full bg-accent" />
      <p className="font-serif text-[19px] leading-[1.55] text-pretty">{entry.text}</p>
    </div>
  ) : (
    <p className="text-[14.5px] leading-relaxed text-muted text-pretty">{entry.text}</p>
  )
}

/**
 * The page before this one, folded to a line. Enough to say the lesson has a
 * past and to re-read it, without spending the rail on it.
 */
function Fold({
  index,
  page,
  entries,
  taught,
}: {
  index: number
  page: Page
  entries: Entry[]
  taught: boolean
}) {
  const said = entries.filter((e) => e.kind === "say").length
  const code = entries.filter((e) => e.kind === "code").length

  return (
    <details className="group mb-4 rounded-lg bg-surface-2">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        {taught ? (
          <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded bg-solid text-on-solid">
            <CheckIcon className="h-2.5 w-2.5" />
          </span>
        ) : (
          <span className="h-[18px] w-[18px] shrink-0 rounded border border-dashed border-line-strong" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {index + 1} · {page.title}
        </span>
        <span className="shrink-0 text-xs text-faint tabular-nums">
          {said} {said === 1 ? "line" : "lines"}
          {code > 0 && ` · ${code} ${code === 1 ? "snippet" : "snippets"}`}
        </span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-open:rotate-180" />
      </summary>
      <ol className="flex flex-col gap-2.5 px-3 pt-1 pb-3">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Beat entry={entry} live={false} />
          </li>
        ))}
      </ol>
    </details>
  )
}
