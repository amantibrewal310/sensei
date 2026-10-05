"use client"

import { useEffect, useRef, useState } from "react"
import { CheckIcon, CodeIcon, CopyIcon } from "@/components/Icons"
import type { Snippet } from "@/lib/code"

// Code as text, in the stream under the sentence that introduced it. Real
// monospace, selectable, copyable, and free to scroll — none of which it had
// as tldraw shapes.
export function CodeCard({ snippet }: { snippet: Snippet }) {
  const label = snippet.label || "code"
  return (
    <figure className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <figcaption className="flex items-center gap-2 border-b border-line py-1 pr-1 pl-3.5">
        <CodeIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
          {label}
        </span>
        <CopyButton lines={snippet.lines} label={label} />
      </figcaption>

      {/* No line numbers: the rail is sized so MAX_CODE_COLS fits at this
          size, and a gutter is the 30px that would push line three into a
          scrollbar. */}
      <pre className="scroll-slim overflow-x-auto px-3.5 py-3 font-mono text-[12px] leading-[1.6]">
        {snippet.lines.map((line, i) => (
          // Lines arrive one at a time, so each is keyed by position and
          // fades in as it lands — the typing-it-out feel the canvas had.
          <div key={i} className="animate-[fadeIn_180ms_ease-out] whitespace-pre">
            {line || " "}
          </div>
        ))}
      </pre>
    </figure>
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
        <CheckIcon className="h-3.5 w-3.5 text-correct" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </button>
  )
}
