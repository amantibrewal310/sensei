import { describe, expect, it } from "vitest"
import { z } from "zod"
import { BoardSchema } from "../lib/board"
import { MAX_TOPIC, PageSchema, Topic } from "../lib/lesson"
import { readBody, safeJson } from "../lib/request"

const post = (body: unknown) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

describe("Topic", () => {
  it("trims surrounding whitespace", () => {
    expect(Topic.parse("  rate limiting  ")).toBe("rate limiting")
  })

  it("rejects whitespace-only, which would otherwise pass a length check", () => {
    expect(Topic.safeParse("   ").success).toBe(false)
  })

  it("rejects a topic longer than the cap", () => {
    // Resent with every board request and every teaching turn, so an essay
    // here is billed once per page for the whole lesson.
    expect(Topic.safeParse("x".repeat(MAX_TOPIC + 1)).success).toBe(false)
    expect(Topic.safeParse("x".repeat(MAX_TOPIC)).success).toBe(true)
  })

  it("rejects control and format characters", () => {
    // Built with fromCharCode rather than written literally: a NUL or a
    // zero-width joiner pasted into the source is invisible, so the assertion
    // would read as "rejects the string 'rate limiting'" to a reviewer.
    const NUL = String.fromCharCode(0x00)
    const ZWJ = String.fromCharCode(0x200d)

    expect(Topic.safeParse("rate\nlimiting").success).toBe(false)
    expect(Topic.safeParse(`rate${NUL}limiting`).success).toBe(false)
    expect(Topic.safeParse(`rate${ZWJ}limiting`).success).toBe(false)
    expect(Topic.safeParse("rate limiting").success).toBe(true)
  })
})

describe("BoardSchema", () => {
  const panel = {
    id: "bucket",
    title: "Token bucket",
    col: 0,
    row: 0,
    colSpan: 1,
    rowSpan: 1,
    note: "the mechanism",
  }

  it("accepts a well-formed board", () => {
    const parsed = BoardSchema.parse({ panels: [panel], connectors: [] })
    expect(parsed.panels).toHaveLength(1)
  })

  it("defaults the fields the model routinely omits", () => {
    const { note, ...withoutNote } = panel
    void note
    const parsed = BoardSchema.parse({ panels: [withoutNote] })
    expect(parsed.panels[0].note).toBe("")
    expect(parsed.connectors).toEqual([])
  })

  it("rejects a negative slot, which would index backwards into the grid", () => {
    expect(BoardSchema.safeParse({ panels: [{ ...panel, col: -1 }] }).success).toBe(
      false,
    )
  })

  it("rejects a non-integer slot", () => {
    expect(
      BoardSchema.safeParse({ panels: [{ ...panel, row: 1.5 }] }).success,
    ).toBe(false)
    expect(
      BoardSchema.safeParse({ panels: [{ ...panel, col: "0" }] }).success,
    ).toBe(false)
  })

  it("rejects a board with no panels at all", () => {
    expect(BoardSchema.safeParse({ panels: [], connectors: [] }).success).toBe(
      false,
    )
  })

  it("leaves off-grid slots to placePanels rather than rejecting the board", () => {
    // placePanels already clamps spans and searches for a free slot. Throwing
    // away five good panels because one asked for column 5 would be worse.
    const parsed = BoardSchema.safeParse({ panels: [{ ...panel, col: 5 }] })
    expect(parsed.success).toBe(true)
  })
})

describe("PageSchema", () => {
  it("requires the id the planner assigned", () => {
    expect(
      PageSchema.safeParse({ title: "Token bucket", question: "how?" }).success,
    ).toBe(false)
  })

  it("defaults kind so an older client is not broken by a new field", () => {
    const page = PageSchema.parse({
      id: "page-1",
      title: "Token bucket",
      question: "how does it work?",
    })
    expect(page.kind).toBe("concept")
    expect(page.summary).toBe("")
  })
})

describe("readBody", () => {
  const Schema = z.object({ topic: Topic })

  it("returns parsed data for a valid body", async () => {
    const result = await readBody(post({ topic: "rate limiting" }), Schema)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.topic).toBe("rate limiting")
  })

  it("answers 400 naming the field that was wrong", async () => {
    const result = await readBody(post({ topic: "" }), Schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      const body = (await result.response.json()) as { error: string }
      expect(body.error).toMatch(/topic/)
    }
  })

  it("answers 400 rather than throwing on a body that is not JSON", async () => {
    const result = await readBody(post("not json at all"), Schema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(400)
  })
})

describe("safeJson", () => {
  it("answers null instead of throwing", () => {
    expect(safeJson("{oops")).toBeNull()
    expect(safeJson('{"a":1}')).toEqual({ a: 1 })
  })
})
