import { beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_TRANSCRIPT } from "@/lib/lesson"

// The SDK is the only thing stubbed. Everything else — zod validation, the
// prompt assembly, the NDJSON parser, the SSE writer — is the real code, which
// is the point: these tests are about what the routes do with what a model
// hands back, and that is exactly where they have no coverage at all.
const create = vi.fn()
const stream = vi.fn()
vi.mock("@/lib/anthropic", () => ({
  anthropic: { messages: { create, stream } },
}))

const { POST: plan } = await import("@/app/api/plan/route")
const { POST: board } = await import("@/app/api/board/route")
const { POST: teach } = await import("@/app/api/teach/route")
const { POST: drawPanel } = await import("@/app/api/draw-panel/route")

const USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

/** What a non-streaming route sees: one text block, and a reason it stopped. */
function replies(text: string, stop_reason = "end_turn") {
  create.mockResolvedValue({
    stop_reason,
    content: [{ type: "text", text }],
    usage: USAGE,
  })
}

/**
 * What a streaming route sees. Split into two chunks on purpose — a parser that
 * only works when each line arrives whole is a parser that fails in production.
 */
function streams(text: string) {
  const half = Math.ceil(text.length / 2)
  stream.mockReturnValue({
    async *[Symbol.asyncIterator]() {
      for (const chunk of [text.slice(0, half), text.slice(half)]) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: chunk } }
      }
    },
    finalMessage: async () => ({ usage: USAGE }),
  })
}

function post(
  route: (req: Request) => Promise<Response>,
  body: unknown,
): Promise<Response> {
  return route(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

/** Every frame a streaming route wrote, in order. */
async function frames(res: Response): Promise<{ event: string; data: string }[]> {
  const { readSse } = await import("@/lib/sse")
  const out = []
  for await (const frame of readSse(res.body!)) out.push(frame)
  return out
}

const PAGE = {
  id: "page-1",
  title: "Token bucket",
  summary: "permits that refill",
  question: "how does it admit requests?",
  kind: "algorithm" as const,
}

const BOARD = {
  panels: [
    { id: "bucket", title: "The bucket", col: 0, row: 0, colSpan: 1, rowSpan: 1, note: "" },
  ],
  connectors: [],
}

const A_PLAN = JSON.stringify({
  pages: [
    { title: "Why limit", summary: "the problem", question: "what breaks?", kind: "concept" },
    { title: "Token bucket", summary: "the mechanism", question: "how?", kind: "algorithm" },
  ],
})

beforeEach(() => {
  vi.clearAllMocks()
  // logUsage writes a line per call, which is wanted in production and noise here.
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("/api/plan", () => {
  it("gives every page an id", async () => {
    replies(A_PLAN)
    const res = await post(plan, { topic: "rate limiting" })
    expect(res.status).toBe(200)
    const { pages } = await res.json()
    expect(pages.map((p: { id: string }) => p.id)).toEqual(["page-1", "page-2"])
  })

  it("answers 502 when the model's plan is not JSON", async () => {
    replies("Sure! Here is your lesson plan:")
    const res = await post(plan, { topic: "rate limiting" })
    expect(res.status).toBe(502)
  })

  it("answers 502 when the plan is JSON but the wrong shape", async () => {
    // One page: `RawPlan` requires two. A lesson of one page is not a lesson,
    // and this is the case a `as Plan` cast would have let straight through.
    replies(JSON.stringify({ pages: [{ title: "T", summary: "s", question: "q", kind: "concept" }] }))
    const res = await post(plan, { topic: "rate limiting" })
    expect(res.status).toBe(502)
  })

  it("distinguishes a declined topic from a broken one", async () => {
    // A refusal arrives on a normal 200 with empty content. Without the
    // stop_reason check it reads as a malformed response, and the learner is
    // told the lesson is broken when in fact the topic was declined.
    create.mockResolvedValue({ stop_reason: "refusal", content: [], usage: USAGE })
    const res = await post(plan, { topic: "something declined" })
    expect(res.status).toBe(422)
  })

  it("rejects an empty topic before calling the model", async () => {
    const res = await post(plan, { topic: "   " })
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects a topic long enough to be an essay", async () => {
    const res = await post(plan, { topic: "a".repeat(500) })
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects a body that is not JSON at all", async () => {
    const res = await plan(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe("/api/board", () => {
  it("returns the panels the model designed", async () => {
    replies(JSON.stringify(BOARD))
    const res = await post(board, { topic: "rate limiting", page: PAGE })
    expect(res.status).toBe(200)
    expect((await res.json()).panels).toHaveLength(1)
  })

  it("answers 502 rather than passing on a panel with a negative span", async () => {
    // These numbers become an occupancy grid and a set of rectangles. This route
    // used to hand the model's output straight to the client unparsed.
    replies(
      JSON.stringify({
        panels: [{ ...BOARD.panels[0], colSpan: -3 }],
        connectors: [],
      }),
    )
    const res = await post(board, { topic: "rate limiting", page: PAGE })
    expect(res.status).toBe(502)
  })

  it("rejects a page that did not come from a plan", async () => {
    const res = await post(board, { topic: "rate limiting", page: { title: "T" } })
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })
})

describe("/api/teach", () => {
  const body = {
    topic: "rate limiting",
    pages: [PAGE],
    currentIndex: 0,
    transcript: [],
    board: BOARD,
  }

  it("streams the teacher's lines through and ends the stream", async () => {
    streams('{"type":"speak","text":"Hello."}\n{"type":"done"}\n')
    const got = await frames(await post(teach, body))

    expect(got.map((f) => f.event)).toEqual(["text", "text", "end"])
    expect(got.filter((f) => f.event === "text").map((f) => JSON.parse(f.data).delta).join(""))
      .toBe('{"type":"speak","text":"Hello."}\n{"type":"done"}\n')
  })

  it("turns a mid-stream failure into an error frame, not a truncated lesson", async () => {
    // Half a turn arrives, then the upstream dies. The client reads this frame
    // and says so; before it existed, the page was left half-taught in silence.
    stream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: '{"type":"speak"' } }
        throw new Error("upstream went away")
      },
      finalMessage: async () => ({ usage: USAGE }),
    })

    const got = await frames(await post(teach, body))
    expect(got[got.length - 1].event).toBe("error")
    expect(JSON.parse(got[got.length - 1].data).message).toBe("upstream went away")
  })

  it("refuses a transcript longer than it will resend", async () => {
    // The regression that matters most here: seven spoken lines a page means a
    // client that never trims crosses this bound mid-lesson, and every turn
    // after it answers 400. See TRANSCRIPT_WINDOW in lib/lesson.ts.
    const res = await post(teach, {
      ...body,
      transcript: Array.from({ length: MAX_TRANSCRIPT + 1 }, () => ({
        role: "assistant",
        text: "a line",
      })),
    })
    expect(res.status).toBe(400)
    expect(stream).not.toHaveBeenCalled()
  })

  it("refuses an index past the end of the outline", async () => {
    const res = await post(teach, { ...body, currentIndex: 7 })
    expect(res.status).toBe(400)
    expect(stream).not.toHaveBeenCalled()
  })
})

describe("/api/draw-panel", () => {
  const body = { title: "The bucket", note: "", what: "the bucket holding tokens", existing: [] }

  it("emits one frame per block", async () => {
    streams(
      '{"kind":"note","text":"one","color":"black"}\n' +
        '{"kind":"row","items":[{"text":"a","color":"black"}]}\n',
    )
    const got = await frames(await post(drawPanel, body))
    expect(got.map((f) => f.event)).toEqual(["block", "block", "done"])
    expect(JSON.parse(got[0].data).text).toBe("one")
  })

  it("drops a line that is not a block instead of failing the beat", async () => {
    // Model output is line-oriented, so one bad line should cost one block, not
    // the drawing. A prose apology in the middle of the stream is the usual case.
    streams(
      "I'll draw that for you:\n" +
        '{"kind":"note","text":"real","color":"black"}\n' +
        '{"kind":"note"}\n',
    )
    const got = await frames(await post(drawPanel, body))
    expect(got.map((f) => f.event)).toEqual(["block", "done"])
  })

  it("drops a stack heading that only repeats the panel title", async () => {
    streams('{"kind":"stack","label":"The Bucket","items":[{"text":"token","color":"black"}]}\n')
    const got = await frames(await post(drawPanel, body))
    expect(JSON.parse(got[0].data).label).toBeUndefined()
  })

  it("rejects existing content that is not blocks", async () => {
    // `existing` is stringified into the prompt, so anything accepted here is
    // something a caller got to put in front of the model.
    const res = await post(drawPanel, { ...body, existing: [{ kind: "sql", text: "drop" }] })
    expect(res.status).toBe(400)
    expect(stream).not.toHaveBeenCalled()
  })
})
