"use client"

import { useEffect, useRef, useState } from "react"
import { CheckIcon, CodeIcon, CopyIcon } from "@/components/Icons"
import type { Snippet } from "@/lib/code"

// Code as text, beside the board rather than on it. Real monospace, selectable,
// copyable, and free to scroll — none of which it had as tldraw shapes.

export function CodePane({ snippets }: { snippets: Snippet[] }) {
  if (!snippets.length) return null

  return (
    // A definite height rather than a share of the column: a percentage
    // max-height needs a definite parent to resolve against, and if that ever
    // stops being true it resolves to `none` and this pane crushes the board.
    <aside
      aria-label="Code from this page"
      className="scroll-slim flex max-h-52 shrink-0 flex-col overflow-y-auto border-t border-line bg-surface lg:max-h-none lg:w-[23rem] lg:border-t-0 lg:border-l xl:w-[26rem]"
    >
      {snippets.map((snippet) => (
        <SnippetBlock key={snippet.id} snippet={snippet} />
      ))}
    </aside>
  )
}

function SnippetBlock({ snippet }: { snippet: Snippet }) {
  return (
    <div className="border-b border-line last:border-b-0">
      {/* Sticky, because a snippet can be taller than the pane and a label that
          scrolls away leaves fourteen lines of unattributed code. */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface-glass px-3 py-2 backdrop-blur">
        <CodeIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
          {snippet.label || "code"}
        </span>
        <CopyButton lines={snippet.lines} label={snippet.label || "code"} />
      </div>

      <pre className="overflow-x-auto px-3 py-3 font-mono text-[12.5px] leading-[1.7]">
        {snippet.lines.map((line, i) => (
          // Lines arrive one at a time, so each is keyed by position and
          // fades in as it lands — the typing-it-out feel the canvas had.
          <div key={i} className="flex animate-[fadeIn_180ms_ease-out] gap-3">
            <span
              aria-hidden="true"
              className="w-4 shrink-0 text-right text-faint select-none tabular-nums"
            >
              {i + 1}
            </span>
            <span className="min-w-0 whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}

/**
 * Copying was the reason this pane exists at all, so it gets a button rather
 * than relying on a selection drag across a scrolling element.
 */
function CopyButton({ lines, label }: { lines: string[]; label: string }) {
  const [copied, setCopied] = useState(false)
  // Changing page within 1.6s of a copy unmounts this button with the timer
  // still holding its setState.
  const resetAt = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(resetAt.current), [])

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-icon"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() => {
        // No fallback path: clipboard writes need a secure context, and so does
        // every other thing this app does. A failure just leaves the button be.
        void navigator.clipboard?.writeText(lines.join("\n")).then(() => {
          setCopied(true)
          clearTimeout(resetAt.current)
          resetAt.current = setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-accent" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </button>
  )
}
