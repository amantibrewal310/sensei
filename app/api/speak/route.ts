import { NextResponse } from "next/server"
import { z } from "zod"
import { env } from "@/lib/env"
import { TTS_MODEL, TTS_VOICE } from "@/lib/models"
import { readBody } from "@/lib/request"

export const runtime = "nodejs"

// One spoken sentence. The teacher is instructed to emit one or two at a time,
// so this is generous — it exists because the field was previously unbounded and
// every character of it is billed to OpenAI.
const MAX_SPEAK = 1000

const SpeakRequest = z.object({
  text: z
    .string()
    .max(MAX_SPEAK)
    .transform((t) => t.trim())
    .refine((t) => t.length > 0, "text is required"),
})

// Narration is OUTPUT ONLY: the lesson is spoken to the learner, and nothing is
// listened for. No microphone is ever requested, so there is no barge-in — the
// learner interrupts by typing. The audio is streamed straight through, so
// playback can begin before the whole sentence has been synthesised.
export async function POST(req: Request) {
  const body = await readBody(req, SpeakRequest)
  if (!body.ok) return body.response
  const { text } = body.data

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
