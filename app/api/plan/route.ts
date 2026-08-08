import { NextResponse } from "next/server"
import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import { PLAN_SYSTEM, PlanJsonSchema, Topic, parsePlan } from "@/lib/lesson"
import { readBody, safeJson } from "@/lib/request"
import { logUsage } from "@/lib/usage"

export const runtime = "nodejs"
// Vercel Hobby defaults a function to 10s and caps it at 60. This route already
// measured at ~15s before thinking was enabled, so without this it fails on the
// very first request of every lesson.
export const maxDuration = 60

const PlanRequest = z.object({ topic: Topic })

// The outline: what pages this lesson has. It is the table of contents the
// learner navigates by, so it is planned once and never revised — jumping back
// to "Token bucket" has to land on the same page you left.
export async function POST(req: Request) {
  const body = await readBody(req, PlanRequest)
  if (!body.ok) return body.response
  const { topic } = body.data

  const started = Date.now()
  const msg = await anthropic.messages.create({
    model: TEACHER_MODEL,
    // Thinking is on by default on this model and max_tokens bounds thinking
    // AND response text together, so the old 3000 — sized for output alone —
    // would now truncate the outline mid-JSON.
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    // PLAN_SYSTEM is only 388 tokens on its own, which looks too small to
    // cache. It isn't: the cacheable prefix includes the JSON schema below,
    // and measurement put the real figure at ~760 — comfortably over this
    // model's 512-token minimum. Prefix, not prompt, is what has to clear the
    // floor, which is why guessing from the prompt length got this wrong.
    system: [
      {
        type: "text",
        text: PLAN_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: PlanJsonSchema },
    },
    messages: [{ role: "user", content: `Topic: ${topic}\n\nDesign the outline.` }],
  })
  logUsage("plan", TEACHER_MODEL, msg.usage, Date.now() - started)

  // A safety classifier can decline on a normal 200, and `content` is then
  // empty — without this the refusal surfaces as the generic "no plan" 502.
  if (msg.stop_reason === "refusal") {
    return NextResponse.json({ error: "topic declined" }, { status: 422 })
  }

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
