"use client"

import { useRef, useState } from "react"
import { createRealtimeVoice } from "@/voice/realtime"
import type { VoiceLayer } from "@/voice/types"

export default function DevVoice() {
  const voiceRef = useRef<VoiceLayer | null>(null)
  const [heard, setHeard] = useState<string[]>([])

  return (
    <div className="p-4 space-y-2">
      <button
        className="border px-4"
        onClick={async () => {
          const v = await createRealtimeVoice()
          v.onUserUtterance((t) => setHeard((h) => [...h, t]))
          voiceRef.current = v
        }}
      >
        Connect
      </button>
      <button
        className="border px-4"
        onClick={() =>
          voiceRef.current?.speak("Hello — can you hear me clearly?")
        }
      >
        Speak
      </button>
      <ul>
        {heard.map((h, i) => (
          <li key={i}>heard: {h}</li>
        ))}
      </ul>
    </div>
  )
}
