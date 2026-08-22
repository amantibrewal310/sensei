"use client"

import { memo } from "react"

import { ChevronDownIcon } from "@/components/Icons"

/**
 * The lesson in text.
 *
 * The lesson is audio and canvas, so this is the only part of it a screen
 * reader can reach — and the only part a person in a quiet room can follow. It
 * is set in the serif on purpose: this is the teacher's voice, not the app's.
 */
// memo: this sits on the streaming path — a code page repaints every 90ms
// (CODE_LINE_MS) and none of these props change with it.
function CaptionDockInner({ caption, spoken }: { caption: string; spoken: string[] }) {
  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 py-4 sm:px-6">
      {/* `polite` rather than `assertive`: sentences arrive every few seconds
          and interrupting the reader each time would make it unusable. */}
      <p
        role="status"
        aria-live="polite"
        className="mx-auto flex min-h-[3.25rem] max-w-3xl items-center justify-center text-center font-serif text-[17px] leading-relaxed text-pretty sm:text-lg"
      >
        {caption}
      </p>

      {/* Closed by default — the lesson is meant to be watched. Open, it
          answers "what did it just say", which is the same question a screen
          reader user has and a distracted one does too. `summary` is focusable
          on its own, so this needs no keyboard handling. */}
      {spoken.length > 0 && (
        <details className="group mx-auto mt-1 max-w-3xl">
          <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full px-3 py-1 text-xs text-faint transition-colors hover:bg-surface-hover hover:text-muted [&::-webkit-details-marker]:hidden">
            <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            What was said ({spoken.length})
          </summary>
          <ol className="scroll-slim mt-2 max-h-40 space-y-1.5 overflow-y-auto rounded-xl bg-surface-2 p-3 text-[13px] leading-relaxed text-muted">
            {spoken.map((line, i) => (
              <li key={`${i}-${line.slice(0, 24)}`} className="flex gap-2.5">
                <span className="w-4 shrink-0 text-right text-faint tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}

export const CaptionDock = memo(CaptionDockInner)
