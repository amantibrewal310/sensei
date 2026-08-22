"use client"

import { memo, useState } from "react"
import { ArrowRightIcon } from "@/components/Icons"

// Its own component so the keystroke state is its own too: typing a question
// used to re-render the whole page — outline, transcript, canvas — per key.
// memo: this sits on the streaming path — a code page repaints every 90ms
// (CODE_LINE_MS) and none of these props change with it.
function AskFormInner({ onAsk }: { onAsk: (text: string) => void }) {
  const [ask, setAsk] = useState("")

  return (
    <form
      className="shrink-0 border-t border-line bg-surface px-4 py-3 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (ask.trim()) {
          onAsk(ask.trim())
          setAsk("")
        }
      }}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        {/* A placeholder is not a label: it disappears the moment anyone
            types, and it is not what a screen reader announces the field by. */}
        <label className="sr-only" htmlFor="ask">
          Ask a question about this page
        </label>
        <input
          id="ask"
          autoComplete="off"
          className="field flex-1 rounded-full"
          placeholder="Ask a question…"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          aria-describedby="ask-hint"
        />
        <button className="btn btn-primary rounded-full" disabled={!ask.trim()}>
          Ask
          <ArrowRightIcon />
        </button>
      </div>
      {/* Said once, quietly, because it is surprising the first time: there is
          no microphone and no barge-in — typing is the interruption. */}
      <p
        id="ask-hint"
        className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-faint"
      >
        Asking cuts the narration off and answers on this page.
      </p>
    </form>
  )
}

export const AskForm = memo(AskFormInner)
