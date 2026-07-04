import { z } from "zod"
import type { Step } from "./types"

const RawStep = z.object({
  label: z.string().min(1),
  question: z.string().min(1),
})

const RawPlan = z.object({
  steps: z.array(RawStep).min(1).max(6),
})

export const PlanJsonSchema = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          question: { type: "string" },
        },
        required: ["label", "question"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
} as const

export function parsePlan(data: unknown): Step[] {
  const parsed = RawPlan.parse(data)
  return parsed.steps.map((s, i) => ({
    id: `step-${i + 1}`,
    label: s.label,
    question: s.question,
  }))
}
