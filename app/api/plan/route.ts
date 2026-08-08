import { NextResponse } from "next/server"
import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import { PLAN_SYSTEM, PlanJsonSchema, Topic, parsePlan } from "@/lib/lesson"
import { readBody, safeJson } from "@/lib/request"

export const runtime = "nodejs"

const PlanRequest = z.object({ topic: Topic })

// The outline: what pages this lesson has. It is the table of contents the
// learner navigates by, so it is planned once and never revised — jumping back
// to "Token bucket" has to land on the same page you left.
export async function POST(req: Request) {
  const body = await readBody(req, PlanRequest)
  if (!body.ok) return body.response
  const { topic } = body.data

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
    return NextResponse.json({ pages: parsePlan(safeJson(text.text)) })
  } catch {
    return NextResponse.json({ error: "invalid plan" }, { status: 502 })
  }
}
