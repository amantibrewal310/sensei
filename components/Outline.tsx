"use client"

import { memo } from "react"

import { CheckIcon, CloseIcon } from "@/components/Icons"
import { PAGE_KIND, type Page } from "@/lib/lesson"

// The index of the book. It is the only navigation the lesson has, and it is
// live from the moment the plan lands — you can see where the lesson is going,
// jump ahead to the algorithm you actually came for, and come back to compare.
//
// Drawn as a spine rather than a list of links: a lesson is ordered, and where
// you are in that order is the one thing this panel exists to say.

// memo: this sits on the streaming path — a code page repaints every 90ms
// (CODE_LINE_MS) and none of these props change with it.
function OutlineInner({
  topic,
  pages,
  currentIndex,
  taught,
  onSelect,
  onClose,
}: {
  topic: string
  pages: Page[]
  currentIndex: number
  taught: string[]
  onSelect: (index: number) => void
  /** Only passed by the phone drawer, which is the only version that closes. */
  onClose?: () => void
}) {
  const done = pages.filter((page) => taught.includes(page.id)).length
  const progress = pages.length ? (done / pages.length) * 100 : 0

  return (
    <nav
      aria-label="Lesson outline"
      className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface lg:w-80"
    >
      <div className="shrink-0 border-b border-line px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="eyebrow">Lesson</div>
            <h2 className="mt-1 line-clamp-2 font-serif text-[15px] leading-snug font-medium">
              {topic || "Planning…"}
            </h2>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-sm btn-icon -mt-1 -mr-2"
              aria-label="Close the outline"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        {pages.length > 0 && (
          <div className="mt-3">
            <div className="meter h-1">
              <div className="meter-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-faint tabular-nums">
              {done} of {pages.length} pages taught
            </p>
          </div>
        )}
      </div>

      <ol className="scroll-slim flex-1 overflow-y-auto p-2">
        {pages.length === 0 && <PlanningSkeleton />}

        {pages.map((page, i) => {
          const current = i === currentIndex
          const taughtHere = taught.includes(page.id)
          const last = i === pages.length - 1
          return (
            <li key={page.id} className="relative">
              {/* The spine. Stops at the last step so the list does not end in
                  a line pointing at nothing. */}
              {!last && (
                <span
                  aria-hidden="true"
                  className={`absolute top-9 bottom-0 left-[1.6875rem] w-px ${
                    taughtHere ? "bg-accent" : "bg-line"
                  }`}
                />
              )}

              <button
                onClick={() => onSelect(i)}
                // Which page you are on, and which you have seen, are both
                // shown only in colour otherwise.
                aria-current={current ? "page" : undefined}
                aria-label={`${page.title}${taughtHere ? " — already taught" : ""}`}
                className={`relative flex w-full gap-3 rounded-lg py-2.5 pr-3 pl-3.5 text-left transition-colors ${
                  current ? "bg-surface-hover" : "hover:bg-surface-hover"
                }`}
              >
                {current && (
                  <span
                    aria-hidden="true"
                    className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent"
                  />
                )}

                <span
                  className={`z-10 mt-px grid h-5.5 w-5.5 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums ${
                    taughtHere
                      ? "border-accent bg-accent text-on-accent"
                      : current
                        ? "border-accent bg-surface text-accent"
                        : "border-line-strong bg-surface text-faint"
                  }`}
                >
                  {taughtHere ? <CheckIcon className="h-3 w-3" /> : i + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[13.5px] leading-snug ${
                      current
                        ? "font-medium text-text"
                        : taughtHere
                          ? "text-text"
                          : "text-muted"
                    }`}
                  >
                    {page.title}
                    {PAGE_KIND[page.kind].badge && (
                      <span className="eyebrow ml-1.5 align-middle">
                        {PAGE_KIND[page.kind].badge}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-faint">
                    {page.summary}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** The outline has a shape before the plan lands, so the panel does not pop in. */
function PlanningSkeleton() {
  return (
    <>
      <li className="px-3.5 py-2 text-[13px] text-faint">Planning the lesson…</li>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} aria-hidden="true" className="flex gap-3 px-3.5 py-2.5">
          <span className="shimmer mt-px h-5.5 w-5.5 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span
              className="shimmer block h-3 rounded"
              style={{ width: `${80 - i * 12}%` }}
            />
            <span
              className="shimmer block h-2.5 rounded"
              style={{ width: `${60 - i * 8}%` }}
            />
          </span>
        </li>
      ))}
    </>
  )
}

export const Outline = memo(OutlineInner)
