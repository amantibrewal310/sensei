"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRightIcon, SparkIcon } from "@/components/Icons"
import { MAX_TOPIC } from "@/lib/lesson"

// Openers, not examples. An empty box asking "what do you want to learn" is a
// harder question than it looks, and every one of these is a topic the planner
// splits into pages cleanly — so a first lesson lands well.
const OPENERS = [
  "rate limiting",
  "the javascript event loop",
  "how DNS resolves a name",
  "B-trees vs LSM trees",
  "what a load balancer actually does",
]

export function TopicForm() {
  const [topic, setTopic] = useState("")
  // The plan takes a few seconds and the navigation happens first, so without
  // this the button looks like it did nothing and gets pressed again.
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function teach(value: string) {
    const trimmed = value.trim()
    if (!trimmed || sending) return
    setSending(true)
    // No sign-in check here on purpose. A signed-out visitor is sent to
    // /login by middleware with this whole URL in `next`, so they come back
    // to the topic they typed instead of an empty box.
    router.push(`/learn?topic=${encodeURIComponent(trimmed)}`)
  }

  return (
    <div className="w-full">
      <form
        className="w-full"
        onSubmit={(e) => {
          e.preventDefault()
          teach(topic)
        }}
      >
        <label className="sr-only" htmlFor="topic">
          What do you want to learn?
        </label>
        <div className="flex items-center gap-2 rounded-2xl border border-line-strong bg-surface p-1.5 shadow-raised transition-colors focus-within:border-accent">
          <SparkIcon className="ml-3 h-5 w-5 shrink-0 text-faint" />
          <input
            id="topic"
            ref={input}
            autoFocus
            maxLength={MAX_TOPIC}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none placeholder:text-faint"
            placeholder="the javascript event loop"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <button
            className="btn btn-primary btn-lg shrink-0"
            disabled={!topic.trim() || sending}
          >
            {sending ? "Planning…" : "Teach me"}
            {!sending && <ArrowRightIcon />}
          </button>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs text-faint">Try</span>
        {OPENERS.map((opener) => (
          <button
            key={opener}
            type="button"
            // Filled in rather than submitted: the point of an opener is to be
            // edited into the thing you actually wanted.
            onClick={() => {
              setTopic(opener)
              input.current?.focus()
            }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-line-strong hover:bg-surface-hover hover:text-text"
          >
            {opener}
          </button>
        ))}
      </div>
    </div>
  )
}
