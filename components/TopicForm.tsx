"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export function TopicForm() {
  const [topic, setTopic] = useState("")
  const router = useRouter()
  return (
    <form
      className="flex w-full max-w-lg gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        // No sign-in check here on purpose. A signed-out visitor is sent to
        // /login by middleware with this whole URL in `next`, so they come back
        // to the topic they typed instead of an empty box.
        if (topic.trim()) router.push(`/learn?topic=${encodeURIComponent(topic.trim())}`)
      }}
    >
      <input
        autoFocus
        className="flex-1 rounded border p-3"
        placeholder="the javascript event loop"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      />
      <button className="rounded bg-black px-5 text-white">Teach me</button>
    </form>
  )
}
