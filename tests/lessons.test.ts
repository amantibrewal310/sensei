import { beforeEach, describe, expect, it, vi } from "vitest"

const APPROVED = {
  id: "u_owner",
  email: "owner@example.com",
  status: "approved",
  role: "user",
}
let currentUser: Record<string, unknown> | null = APPROVED
vi.mock("@/lib/auth", () => ({
  auth: async () => (currentUser ? { user: currentUser } : null),
}))

// The limit query, present only so that a route wired to withGuard by mistake
// would still run — and then be caught by the test that says it must not be.
let limitRow = { user_micros: "0", global_micros: "0", recent: 0 }

// A tiny stand-in for the two tables, enough to tell an insert from an update
// and to answer a select.
let lessonRows: Record<string, unknown>[] = []
let pageRows: Record<string, unknown>[] = []
const calls: string[] = []

vi.mock("@/lib/db", () => {
  const chain = (rows: () => Record<string, unknown>[]) => {
    const self: Record<string, unknown> = {}
    for (const k of ["from", "leftJoin", "where", "groupBy", "orderBy", "limit"]) {
      self[k] = () => self
    }
    // Awaiting the builder is what runs it, so the thenable is the seam.
    self.then = (resolve: (v: unknown) => void) => resolve(rows())
    return self
  }
  return {
    db: {
      execute: async () => ({ rows: [limitRow] }),
      select: (shape?: unknown) => chain(() => (shape ? lessonRows : lessonRows)),
      insert: (table: { _name?: string }) => ({
        values: (row: Record<string, unknown>) => {
          const target = table._name === "lesson" ? lessonRows : pageRows
          const stored = { ...row, id: row.id ?? `${table._name}_1` }
          target.push(stored)
          calls.push(`insert:${table._name}`)
          const out: Record<string, unknown> = {
            returning: () => Promise.resolve([{ id: stored.id }]),
            onConflictDoUpdate: () => Promise.resolve(undefined),
            then: (r: (v: unknown) => void) => r(undefined),
          }
          return out
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
    lessons: { _name: "lesson", id: "id", userId: "user_id", createdAt: "created_at" },
    lessonPages: { _name: "lesson_page", lessonId: "lesson_id", idx: "idx" },
    usageEvents: {},
  }
})

const { POST: saveLesson, GET: listLessons } = await import("@/app/api/lessons/route")

const PAGE = {
  id: "page-1",
  title: "Token bucket",
  summary: "permits that refill",
  question: "how does it admit requests?",
  kind: "algorithm" as const,
}

const BODY = {
  topic: "rate limiting",
  pages: [PAGE],
  idx: 0,
  board: {
    panels: [
      {
        id: "bucket",
        title: "The bucket",
        col: 0,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
        note: "",
      },
    ],
    connectors: [],
  },
  beats: [
    { kind: "speak", text: "A token bucket holds permits." },
    { kind: "panel", panel: "bucket", blocks: [{ kind: "note", text: "refills" }] },
  ],
}

function post(body: unknown) {
  return saveLesson(
    new Request("http://localhost/api/lessons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  currentUser = APPROVED
  limitRow = { user_micros: "0", global_micros: "0", recent: 0 }
  lessonRows = []
  pageRows = []
  calls.length = 0
})

describe("saving a lesson", () => {
  it("creates the lesson on the first page and returns its id", async () => {
    const res = await post(BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ lessonId: expect.any(String) })
    expect(calls).toContain("insert:lesson")
    expect(calls).toContain("insert:lesson_page")
  })

  it("rejects beats that are not beats", async () => {
    // These land in jsonb and are read back later to drive the renderer. A
    // column that accepts anything is exactly why the shape is checked here.
    const res = await post({ ...BODY, beats: [{ kind: "sudo", cmd: "rm -rf" }] })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it("rejects a block shape the renderer could not draw", async () => {
    const res = await post({
      ...BODY,
      beats: [
        { kind: "panel", panel: "bucket", blocks: [{ kind: "sql", text: "drop" }] },
      ],
    })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it("refuses a caller who is not signed in", async () => {
    currentUser = null
    expect((await post(BODY)).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it("refuses a caller still waiting for approval", async () => {
    currentUser = { ...APPROVED, status: "pending" }
    expect((await post(BODY)).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it("still works when the spend caps have been blown", async () => {
    // The whole reason lessons are stored. A budget check in front of a route
    // that spends nothing would break the replay at exactly the moment the live
    // path already has — which is when you need the replay.
    limitRow = { user_micros: "999000000", global_micros: "999000000", recent: 9999 }
    expect((await post(BODY)).status).toBe(200)

    const list = await listLessons()
    expect(list.status).toBe(200)
  })
})
