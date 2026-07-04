import { NextResponse } from "next/server"
import { anthropic } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import { PlanJsonSchema, parsePlan } from "@/lib/plan-schema"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { topic } = await req.json().catch(() => ({ topic: "" }))
  if (typeof topic !== "string" || !topic.trim()) {
    return NextResponse.json({ error: "topic required" }, { status: 400 })
  }

  const msg = await anthropic.messages.create({
    model: TEACHER_MODEL,
    max_tokens: 2000,
    system:
      "You design a short curiosity-first learning path: 3-4 questions covering why / how / a surprise / limits.",
    output_config: {
      format: { type: "json_schema", schema: PlanJsonSchema },
    },
    messages: [
      {
        role: "user",
        content: `Topic: ${topic}\nReturn 3-4 teaching questions as JSON.`,
      },
    ],
  })

  const text = msg.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") {
    return NextResponse.json({ error: "no plan" }, { status: 502 })
  }
  try {
    const steps = parsePlan(JSON.parse(text.text))
    return NextResponse.json({ steps })
  } catch {
    return NextResponse.json({ error: "invalid plan" }, { status: 502 })
  }
}
