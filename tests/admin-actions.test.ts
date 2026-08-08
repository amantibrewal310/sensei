import { beforeEach, describe, expect, it, vi } from "vitest"

// The action's job is to refuse before it writes, so the database is a spy: if
// a refusal ever reaches it, `updates` is non-empty and the test says so.
const updates: { set: Record<string, unknown>; where: unknown }[] = []

let session: { user?: Record<string, unknown> } | null = null
vi.mock("@/lib/auth", () => ({ auth: async () => session }))

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (where: unknown) => {
          updates.push({ set: values, where })
        },
      }),
    }),
  },
  users: { id: "user.id" },
}))

// `eq` builds a drizzle SQL node from real column objects, and the table above
// is a stub. Nothing here asserts on the clause, so a plain marker is enough.
vi.mock("drizzle-orm", () => ({ eq: (col: unknown, val: unknown) => ({ col, val }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

const { decide } = await import("@/app/admin/actions")

const ADMIN = {
  id: "u_admin",
  email: "admin@example.com",
  status: "approved",
  role: "admin",
}

describe("decide", () => {
  beforeEach(() => {
    updates.length = 0
    session = { user: { ...ADMIN } }
  })

  it("approves somebody, stamping when and by whom", async () => {
    await decide({ userId: "u_learner", status: "approved" })
    expect(updates).toHaveLength(1)
    expect(updates[0].set).toMatchObject({ status: "approved", approvedBy: "u_admin" })
    expect(updates[0].set.approvedAt).toBeInstanceOf(Date)
  })

  it("clears approvedAt on rejection rather than leaving a stale approval", async () => {
    await decide({ userId: "u_learner", status: "rejected" })
    expect(updates[0].set).toMatchObject({ status: "rejected", approvedAt: null })
    // Who made the call survives either way — that is the part worth keeping.
    expect(updates[0].set.approvedBy).toBe("u_admin")
  })

  it("refuses a caller who is not an admin, and writes nothing", async () => {
    session = { user: { ...ADMIN, id: "u_learner", role: "user" } }
    await expect(decide({ userId: "u_other", status: "approved" })).rejects.toThrow(
      /not authorised/,
    )
    expect(updates).toHaveLength(0)
  })

  it("refuses a caller who is signed out", async () => {
    session = null
    await expect(decide({ userId: "u_other", status: "approved" })).rejects.toThrow()
    expect(updates).toHaveLength(0)
  })

  it("refuses an admin acting on their own row", async () => {
    // Rejecting the only account that can approve anyone leaves no way back in
    // except SQL. The page hides the buttons; this is what actually prevents it.
    await expect(decide({ userId: "u_admin", status: "rejected" })).rejects.toThrow(
      /own status/,
    )
    expect(updates).toHaveLength(0)
  })

  it("refuses a status that is not one of the two", async () => {
    // The argument arrives over the wire like any request body. `status` going
    // straight into an UPDATE is exactly the cast this codebase removed
    // everywhere else.
    await expect(
      decide({ userId: "u_learner", status: "admin" } as never),
    ).rejects.toThrow()
    expect(updates).toHaveLength(0)
  })
})
