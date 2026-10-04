"use client"

import { memo, useEffect, useRef, useState } from "react"

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
} from "@/components/Icons"
import { PAGE_KIND, type Page } from "@/lib/lesson"

// The lesson's navigation, in the header. A row of boxes says how far along the
// lesson is at a glance — the logo's three boxes, put to work — and the current
// title says where you are. Every page is one click away behind that title,
// which is what the 320px outline rail used to spend the whole lesson on.

// memo: this sits on the streaming path — a code page repaints every 90ms
// (CODE_LINE_MS) and none of these props change with it.
function PageNavInner({
  pages,
  currentIndex,
  taught,
  onSelect,
}: {
  pages: Page[]
  currentIndex: number
  taught: string[]
  onSelect: (index: number) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLOListElement>(null)

  // Focus goes to the page you are on, so arrowing or tabbing starts from
  // there rather than from the top of a nine-item list.
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLButtonElement>("[aria-current]")?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setOpen(false)
      trigger.current?.focus()
    }
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

  if (!pages.length) {
    return (
      <div
        aria-hidden="true"
        className="shimmer h-9 w-56 rounded-lg border border-line sm:w-72"
      />
    )
  }

  const page = pages[currentIndex]
  const select = (index: number) => {
    setOpen(false)
    trigger.current?.focus()
    onSelect(index)
  }

  return (
    <div ref={root} className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(currentIndex - 1)}
        disabled={currentIndex === 0}
        className="btn btn-ghost btn-sm btn-icon"
        aria-label="Previous page"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
      </button>

      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="page-list"
        className="flex h-9 min-w-0 items-center gap-3 rounded-lg border border-line bg-surface px-3 transition-colors hover:border-line-strong"
      >
        <span aria-hidden="true" className="hidden items-center gap-1 md:flex">
          {pages.map((p, i) => (
            <Box key={p.id} done={taught.includes(p.id)} current={i === currentIndex} />
          ))}
        </span>
        <span aria-hidden="true" className="hidden h-4 w-px bg-line md:block" />
        <span className="font-mono text-xs text-muted tabular-nums">
          {currentIndex + 1}/{pages.length}
        </span>
        <span className="max-w-[9rem] truncate font-serif text-[15px] font-medium sm:max-w-[15rem]">
          {page?.title}
        </span>
        <span className="sr-only">— show all pages</span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <button
        type="button"
        onClick={() => onSelect(currentIndex + 1)}
        disabled={currentIndex >= pages.length - 1}
        className="btn btn-ghost btn-sm btn-icon"
        aria-label="Next page"
      >
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </button>

      {open && (
        <nav
          id="page-list"
          aria-label="Lesson outline"
          className="absolute top-full left-1/2 z-40 mt-2 w-[26rem] max-w-[calc(100vw-1rem)] -translate-x-1/2 animate-[fadeIn_140ms_ease-out] rounded-[10px] border border-line bg-surface p-1.5 shadow-float"
        >
          <ol ref={list} className="scroll-slim max-h-[70vh] overflow-y-auto">
            {pages.map((p, i) => {
              const current = i === currentIndex
              const done = taught.includes(p.id)
              const badge = PAGE_KIND[p.kind].badge
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => select(i)}
                    aria-current={current ? "page" : undefined}
                    aria-label={`${p.title}${done ? " — already taught" : ""}`}
                    className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                      current ? "bg-surface-hover" : "hover:bg-surface-hover"
                    }`}
                  >
                    <span className="w-4 shrink-0 text-right font-mono text-[11px] text-faint tabular-nums">
                      {i + 1}
                    </span>
                    <Mark done={done} current={current} />
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        current
                          ? "font-medium text-text"
                          : done
                            ? "text-text"
                            : "text-muted"
                      }`}
                    >
                      {p.title}
                    </span>
                    <span className="eyebrow w-20 shrink-0 text-right">{badge}</span>
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="mt-1 border-t border-line px-2.5 pt-2 pb-1 text-xs text-faint">
            {taught.length} of {pages.length} taught · a taught page comes back as you
            left it
          </p>
        </nav>
      )}
    </div>
  )
}

/** One page in the header track. Ink once taught, pen while it is the page. */
function Box({ done, current }: { done: boolean; current: boolean }) {
  return (
    <span
      className={`h-2.5 w-2.5 rounded-[2px] ${
        current
          ? "border-2 border-accent"
          : done
            ? "bg-solid"
            : "border border-line-strong"
      }`}
    />
  )
}

/** The same states at list size, with the check that says it without colour. */
function Mark({ done, current }: { done: boolean; current: boolean }) {
  if (done && !current) {
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-solid text-on-solid">
        <CheckIcon className="h-3 w-3" />
      </span>
    )
  }
  return (
    <span
      className={`h-5 w-5 shrink-0 rounded ${
        current
          ? "border-2 border-accent bg-accent-soft"
          : "border border-dashed border-line-strong"
      }`}
    />
  )
}

export const PageNav = memo(PageNavInner)
