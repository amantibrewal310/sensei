"use client"

import { PAGE_KIND, type Page } from "@/lib/lesson"

// The index of the book. It is the only navigation the lesson has, and it is
// live from the moment the plan lands — you can see where the lesson is going,
// jump ahead to the algorithm you actually came for, and come back to compare.

export function Outline({
  topic,
  pages,
  currentIndex,
  taught,
  onSelect,
}: {
  topic: string
  pages: Page[]
  currentIndex: number
  taught: string[]
  onSelect: (index: number) => void
}) {
  return (
    <nav className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white lg:w-72">
      <div className="border-b border-neutral-200 px-5 py-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
          Outline
        </div>
        <div className="mt-1 truncate text-sm font-medium text-neutral-900">
          {topic || "…"}
        </div>
      </div>

      <ol className="flex-1 overflow-y-auto p-2">
        {pages.length === 0 && (
          <li className="px-3 py-2 text-sm text-neutral-400">
            Planning the lesson…
          </li>
        )}
        {pages.map((page, i) => {
          const current = i === currentIndex
          const done = taught.includes(page.id)
          return (
            <li key={page.id}>
              <button
                onClick={() => onSelect(i)}
                className={`group flex w-full gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                  current ? "bg-neutral-100" : "hover:bg-neutral-50"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums ${
                    done
                      ? "bg-neutral-900 text-white"
                      : current
                        ? "border border-neutral-900 text-neutral-900"
                        : "border border-neutral-300 text-neutral-400"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm leading-snug ${
                      current
                        ? "font-medium text-neutral-900"
                        : done
                          ? "text-neutral-700"
                          : "text-neutral-500"
                    }`}
                  >
                    {page.title}
                    {PAGE_KIND[page.kind].badge && (
                      <span className="ml-1.5 align-middle text-[10px] uppercase tracking-wider text-neutral-400">
                        {PAGE_KIND[page.kind].badge}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-neutral-400">
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
