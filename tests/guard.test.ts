import { beforeEach, describe, expect, it, vi } from "vitest"

// One mutable session, so a case is a single assignment. `auth` is the only
// thing replaced; the guard under test is real.
type FakeUser = {
  id?: string
  email?: string | null
  status?: string
  role?: string
}
let session: { user?: FakeUser } | null = null

vi.mock("@/lib/auth", () => ({ auth: async () => session }))

const { requireApproved } = await import("@/lib/guard")

const APPROVED: FakeUser = {
  id: "u_1",
  email: "learner@example.com",
  status: "approved",
  role: "user",
}

/** The refusal branch, unwrapped — status and the message the client displays. */
async function refusal() {
  const gate = await requireApproved()
  if (gate.ok) throw new Error("expected the guard to refuse")
  return {
    status: gate.response.status,
    body: (await gate.response.json()) as { error: string },
  }
}

describe("requireApproved", () => {
  beforeEach(() => {
    session = null
  })

  it("lets an approved learner through, carrying who they are", async () => {
    session = { user: { ...APPROVED } }
    const gate = await requireApproved()
    expect(gate.ok).toBe(true)
    if (!gate.ok) return
    expect(gate.user).toEqual({
      id: "u_1",
      email: "learner@example.com",
      role: "user",
    })
  })

  it("answers 401 when nobody is signed in", async () => {
    expect(await refusal()).toMatchObject({ status: 401 })
  })

  it("answers 403, not 401, for an account still waiting", async () => {
    // The distinction is the whole reason there are two codes here. A client
    // that read this as "your session expired" would send them back through
    // Google, which changes nothing, forever.
    session = { user: { ...APPROVED, status: "pending" } }
    const { status, body } = await refusal()
    expect(status).toBe(403)
    expect(body.error).toMatch(/waiting for approval/i)
  })

  it("says something different to an account that was rejected", async () => {
    session = { user: { ...APPROVED, status: "rejected" } }
    const { status, body } = await refusal()
    expect(status).toBe(403)
    expect(body.error).toMatch(/not approved/i)
    expect(body.error).not.toMatch(/waiting/i)
  })

  it("refuses a session with no id rather than trusting the shape", async () => {
    // A half-built session is the failure worth being paranoid about: it is
    // what a broken callback produces, and `user.id` is what usage is billed
    // to. Defaulting to yes here would be an unattributable spend.
    session = { user: { ...APPROVED, id: undefined } }
    expect(await refusal()).toMatchObject({ status: 401 })
  })

  it("refuses a session with no email", async () => {
    session = { user: { ...APPROVED, email: null } }
    expect(await refusal()).toMatchObject({ status: 401 })
  })
})
