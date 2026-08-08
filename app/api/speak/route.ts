import { NextResponse } from "next/server"
import { env } from "@/lib/env"
import { TTS_MODEL, TTS_VOICE } from "@/lib/models"

export const runtime = "nodejs"

// Narration is OUTPUT ONLY: the lesson is spoken to the learner, and nothing is
// listened for. No microphone is ever requested, so there is no barge-in — the
// learner interrupts by typing. The audio is streamed straight through, so
// playback can begin before the whole sentence has been synthesised.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: string } | null
  const text = body?.text

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 })
  }

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      response_format: "mp3",
      instructions:
        "You are a warm, curious teacher explaining an idea at a whiteboard. " +
        "Speak in English. Unhurried and clear, with the natural emphasis of " +
        "someone who finds this genuinely interesting.",
    }),
  })

  if (!res.ok || !res.body) {
    return NextResponse.json(
      { error: `speech synthesis failed: ${res.status}` },
      { status: 502 },
    )
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  })
}
