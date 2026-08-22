"use client"

import { memo } from "react"

import { ArrowLeftIcon, ArrowRightIcon } from "@/components/Icons"
import { PAGE_KIND, type Page } from "@/lib/lesson"

/**
 * The page-level header: what is on the board right now, and the two buttons
 * for moving off it.
 *
 * Those buttons are new. Stepping through the lesson used to be possible only
 * from the outline, which is the one panel a narrow window hides — so on a
 * laptop with the code pane open there was no way forward but to reopen it.
 */
// memo: this sits on the streaming path — a code page repaints every 90ms
// (CODE_LINE_MS) and none of these props change with it.
function StageHeaderInner({
  page,
  index,
  total,
  onSelect,
}: {
  page?: Page
  index: number
  total: number
  onSelect: (index: number) => void
}) {
  if (!page) return null
  const badge = PAGE_KIND[page.kind].badge

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate font-serif text-[15px] leading-tight font-medium">
            {page.title}
          </h1>
          {badge && <span className="badge badge-neutral shrink-0">{badge}</span>}
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-faint">{page.summary}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="px-1 text-xs text-faint tabular-nums">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          onClick={() => onSelect(index - 1)}
          disabled={index === 0}
          className="btn btn-secondary btn-sm btn-icon"
          aria-label="Previous page"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onSelect(index + 1)}
          disabled={index >= total - 1}
          className="btn btn-secondary btn-sm btn-icon"
          aria-label="Next page"
        >
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export const StageHeader = memo(StageHeaderInner)
