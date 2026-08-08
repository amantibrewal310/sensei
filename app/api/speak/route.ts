import { NextResponse } from "next/server"
import { z } from "zod"
import { env } from "@/lib/env"
import { TTS_MODEL, TTS_VOICE } from "@/lib/models"
import { readBody } from "@/lib/request"
import { requireApproved } from "@/lib/guard"

export const runtime = "nodejs"
// Vercel Hobby: 10s default, 60s ceiling. Synthesis is ~1s, but the audio is
// streamed straight through, so the ceiling covers playback start to finish.
export const maxDuration = 60

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
  // Before the body is even read: an unapproved caller does not get to hand
  // this route work, and every path past here costs money.
  const gate = await requireApproved()
  if (!gate.ok) return gate.response

  const body = await readBody(req, SpeakRequest)
  if (!body.ok) return body.response
  const { text } = body.data

  let res: Response
  try {
    res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      // The learner interrupts several sentences ahead of the voice, so this
      // request is routinely abandoned by the browser while it is still open.
      // Without the signal the function stays alive streaming audio to nobody —
      // and on Hobby, function duration is the thing being spent.
      signal: req.signal,
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
  } catch {
    // Aborted, or the upstream is unreachable. Either way nothing here should
    // throw out of the handler: in the common case the client that asked for
    // this audio has already gone, and the narrator treats any failure as
    // silence anyway.
    return new Response(null, { status: 499 })
  }

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
