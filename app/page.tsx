"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function Home() {
  const [topic, setTopic] = useState("")
  const router = useRouter()
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">sensei</h1>
      <p className="text-neutral-500">What do you want to learn?</p>
      <form
        className="flex w-full max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (topic.trim())
            router.push(`/learn?topic=${encodeURIComponent(topic.trim())}`)
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
    </main>
  )
}
