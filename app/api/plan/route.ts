import { z } from "zod"
import { cachedSystem, modelJson } from "@/lib/claude"
import { TEACHER_MODEL } from "@/lib/models"
import { PLAN_SYSTEM, PlanJsonSchema, Topic, parsePlan } from "@/lib/lesson"
import { readBody } from "@/lib/request"
import { withGuard } from "@/lib/guard"

export const runtime = "nodejs"
// Vercel Hobby defaults a function to 10s and caps it at 60. This route already
// measured at ~15s before thinking was enabled, so without this it fails on the
// very first request of every lesson.
export const maxDuration = 60

const ROUTE = "plan"

const PlanRequest = z.object({ topic: Topic })

// The outline: what pages this lesson has. It is the table of contents the
// learner navigates by, so it is planned once and never revised — jumping back
// to "Token bucket" has to land on the same page you left.
export const POST = withGuard(ROUTE, async (req, user) => {
  const body = await readBody(req, PlanRequest)
  if (!body.ok) return body.response
  const { topic } = body.data

  return modelJson({
    route: ROUTE,
    userId: user.id,
    params: {
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
      system: cachedSystem(PLAN_SYSTEM),
      output_config: {
        format: { type: "json_schema", schema: PlanJsonSchema },
      },
      messages: [{ role: "user", content: `Topic: ${topic}\n\nDesign the outline.` }],
    },
    noun: "plan",
    declined: "topic declined",
    parse: (json) => ({ pages: parsePlan(json) }),
  })
})
