import { NextResponse } from "next/server"
import { anthropic } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import { PLAN_SYSTEM, PlanJsonSchema, parsePlan } from "@/lib/lesson"

export const runtime = "nodejs"

// The outline: what pages this lesson has. It is the table of contents the
// learner navigates by, so it is planned once and never revised — jumping back
// to "Token bucket" has to land on the same page you left.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const topic =
    body && typeof body === "object"
      ? (body as { topic?: unknown }).topic
      : undefined
  if (typeof topic !== "string" || !topic.trim()) {
    return NextResponse.json({ error: "topic required" }, { status: 400 })
  }

  const msg = await anthropic.messages.create({
    model: TEACHER_MODEL,
    max_tokens: 3000,
    system: PLAN_SYSTEM,
    output_config: {
      format: { type: "json_schema", schema: PlanJsonSchema },
    },
    messages: [
      { role: "user", content: `Topic: ${topic}\n\nDesign the outline.` },
    ],
  })

  const text = msg.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") {
    return NextResponse.json({ error: "no plan" }, { status: 502 })
  }
  try {
    return NextResponse.json({ pages: parsePlan(JSON.parse(text.text)) })
  } catch {
    return NextResponse.json({ error: "invalid plan" }, { status: 502 })
  }
}
