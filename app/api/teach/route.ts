import { NextResponse } from "next/server"
import { anthropic, sseResponse } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import { TEACHER_SYSTEM } from "@/lib/prompts"
import type { Step } from "@/lib/types"

export const runtime = "nodejs"

interface Body {
  steps: Step[]
  currentIndex: number
  transcript: { role: "user" | "assistant"; text: string }[]
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null
  const steps = body?.steps
  const currentIndex = body?.currentIndex
  const transcript = body?.transcript ?? []
  if (
    !Array.isArray(steps) ||
    typeof currentIndex !== "number" ||
    !steps[currentIndex]
  ) {
    return NextResponse.json(
      { error: "invalid teach request" },
      { status: 400 },
    )
  }
  const current = steps[currentIndex]
  const upcoming = steps
    .slice(currentIndex + 1)
    .map((s, i) => `Q${currentIndex + 2 + i} (${s.label}): ${s.question}`)
    .join("\n")

  const context =
    `Current question (Q${currentIndex + 1}, ${current.label}): ${current.question}\n` +
    (upcoming ? `Upcoming:\n${upcoming}\n` : "This is the final question.\n")

  const messages = [
    { role: "user" as const, content: `System context:\n${context}` },
    ...transcript.map((t) => ({ role: t.role, content: t.text })),
    {
      role: "user" as const,
      content:
        "Teach this question now. Emit exactly one NDJSON turn (plan, speak, optional draw, done). Stop after done.",
    },
  ]

  async function* gen() {
    const stream = anthropic.messages.stream({
      model: TEACHER_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [
        { type: "text", text: TEACHER_SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages,
    })
    for await (const ev of stream) {
      if (
        ev.type === "content_block_delta" &&
        ev.delta.type === "text_delta"
      ) {
        yield { event: "text", data: { delta: ev.delta.text } }
      }
    }
    yield { event: "end", data: {} }
  }

  return sseResponse(gen())
}
