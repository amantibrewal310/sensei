import { beforeEach, describe, expect, it, vi } from "vitest"
import { CLEAR_LIMITS as CLEAR } from "./fixtures"

// One row, standing in for the single query checkLimits runs. The arithmetic
// and the ordering are the real code.
let row: { user_micros: string; global_micros: string; recent: number } | undefined

vi.mock("@/lib/db", () => ({
  db: { execute: async () => ({ rows: row ? [row] : [] }) },
  usageEvents: {},
}))

const { checkLimits, GLOBAL_CAP_MICROS, RATE_LIMIT, USER_CAP_MICROS } =
  await import("@/lib/limits")

describe("checkLimits", () => {
  beforeEach(() => {
    row = { ...CLEAR }
  })

  it("allows a caller who is under everything", async () => {
    expect(await checkLimits("u_1")).toBeNull()
  })

  it("allows a caller who is one micro under their cap", async () => {
    // The boundary in the direction that matters: a cap that trips early is a
    // cap that costs somebody a lesson they were entitled to.
    row = { ...CLEAR, user_micros: String(USER_CAP_MICROS - 1) }
    expect(await checkLimits("u_1")).toBeNull()
  })

  it("stops them exactly at the cap", async () => {
    row = { ...CLEAR, user_micros: String(USER_CAP_MICROS) }
    expect(await checkLimits("u_1")).toMatchObject({ retryable: false })
  })

  it("allows the last call before the rate limit", async () => {
    row = { ...CLEAR, recent: RATE_LIMIT - 1 }
    expect(await checkLimits("u_1")).toBeNull()
  })

  it("stops them at the rate limit, retryably", async () => {
    row = { ...CLEAR, recent: RATE_LIMIT }
    expect(await checkLimits("u_1")).toMatchObject({ retryable: true })
  })

  it("trips the global ceiling even for somebody who has spent nothing", async () => {
    // The kill switch, and the reason it is not just a per-user cap: the
    // failure it exists for is the one where the problem is not one account.
    row = { ...CLEAR, user_micros: "0", global_micros: String(GLOBAL_CAP_MICROS) }
    const denial = await checkLimits("u_innocent")
    expect(denial).toMatchObject({ retryable: false })
    expect(denial?.reason).toMatch(/monthly API budget/i)
    // Whose spending it was is nobody else's business, and naming them would
    // put another person's usage in front of whoever happens to hit this.
    expect(denial?.reason).not.toMatch(/u_/)
  })

  it("reports the permanent refusal when both a cap and the rate limit are hit", async () => {
    // Both are true. Answering "wait a moment" would send a well-behaved client
    // into retrying forever against a wall that does not move until the month
    // ends.
    row = {
      user_micros: String(USER_CAP_MICROS),
      global_micros: String(GLOBAL_CAP_MICROS),
      recent: RATE_LIMIT * 10,
    }
    expect(await checkLimits("u_1")).toMatchObject({ retryable: false })
  })

  it("does not block when the table is empty", async () => {
    // The very first call ever made, before a single usage row exists.
    row = undefined
    expect(await checkLimits("u_1")).toBeNull()
  })

  it("handles the string form postgres sends for a bigint", async () => {
    // Documenting the wire format rather than guarding it: a bigint arrives as
    // a string, and `"9000000" >= 5000000` happens to be true anyway because a
    // string compared against a number is coerced numerically. The explicit
    // Number() in checkLimits is for the next person who writes arithmetic on
    // these, where "9" + "1" would not be 10.
    row = { ...CLEAR, user_micros: String(USER_CAP_MICROS * 2) }
    expect(await checkLimits("u_1")).toMatchObject({ retryable: false })
  })
})
