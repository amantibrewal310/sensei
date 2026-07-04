import { describe, it, expect } from "vitest"
import { parsePlan } from "@/lib/plan-schema"

describe("parsePlan", () => {
  it("validates and assigns sequential ids", () => {
    const steps = parsePlan({
      steps: [
        { label: "Why", question: "Why does X exist?" },
        { label: "How", question: "How does X work?" },
        { label: "Limits", question: "When does X break?" },
      ],
    })
    expect(steps).toEqual([
      { id: "step-1", label: "Why", question: "Why does X exist?" },
      { id: "step-2", label: "How", question: "How does X work?" },
      { id: "step-3", label: "Limits", question: "When does X break?" },
    ])
  })

  it("throws when steps missing or empty", () => {
    expect(() => parsePlan({ steps: [] })).toThrow()
    expect(() => parsePlan({})).toThrow()
  })
})
