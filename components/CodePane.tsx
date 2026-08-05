"use client"

import type { Snippet } from "@/lib/code"

// Code as text, beside the board rather than on it. Real monospace, selectable,
// copyable, and free to scroll — none of which it had as tldraw shapes.

export function CodePane({ snippets }: { snippets: Snippet[] }) {
  if (!snippets.length) return null

  return (
    <aside className="flex w-[24rem] shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-white lg:w-[26rem]">
      {snippets.map((snippet) => (
        <div key={snippet.id} className="border-b border-neutral-200 last:border-b-0">
          <div className="flex items-baseline gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2">
            <span className="font-mono text-xs font-medium text-neutral-900">
              {snippet.label || "code"}
            </span>
          </div>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-[1.65] text-neutral-800">
            {snippet.lines.map((line, i) => (
              // Lines arrive one at a time, so each is keyed by position and
              // fades in as it lands — the typing-it-out feel the canvas had.
              <div key={i} className="animate-[fadeIn_180ms_ease-out]">
                {line || " "}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </aside>
  )
}
