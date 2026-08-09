import { beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_TRANSCRIPT } from "@/lib/lesson"
import { GLOBAL_CAP_MICROS, RATE_LIMIT, USER_CAP_MICROS } from "@/lib/limits"
import { TTS_MICROS_PER_CHAR } from "@/lib/models"

// The SDK is the only thing stubbed. Everything else — zod validation, the
// prompt assembly, the NDJSON parser, the SSE writer — is the real code, which
// is the point: these tests are about what the routes do with what a model
// hands back, and that is exactly where they have no coverage at all.
const create = vi.fn()
const stream = vi.fn()
vi.mock("@/lib/anthropic", () => ({
  anthropic: { messages: { create, stream } },
}))

// The second stub, and the seam is chosen deliberately: `auth` is replaced,
// `lib/guard` is not. These tests run the real guard against a real session
// shape, so the day the session stops carrying `status` they go red here rather
// than opening the routes to everyone in silence. What the guard does when the
// answer is no is tests/guard.test.ts.
const APPROVED = {
  id: "u_test",
  email: "learner@example.com",
  status: "approved",
  role: "user",
}
let currentUser: Record<string, unknown> | null = APPROVED
vi.mock("@/lib/auth", () => ({
  auth: async () => (currentUser ? { user: currentUser } : null),
}))

// The database, and only the database. `lib/limits` and `lib/usage` stay real,
// so these tests exercise the actual cap arithmetic and the actual insert —
// what is faked is the one thing that would otherwise need a network.
let limitRow = { user_micros: "0", global_micros: "0", recent: 0 }
const inserted: Record<string, unknown>[] = []
vi.mock("@/lib/db", () => ({
  db: {
    execute: async () => ({ rows: [limitRow] }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserted.push(row)
      },
    }),
  },
  usageEvents: {},
}))

const { POST: plan } = await import("@/app/api/plan/route")
const { POST: board } = await import("@/app/api/board/route")
const { POST: teach } = await import("@/app/api/teach/route")
const { POST: drawPanel } = await import("@/app/api/draw-panel/route")
const { POST: speak } = await import("@/app/api/speak/route")

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
 * Usage rides the stream the way it does on the wire: input and cache counts on
 * message_start, cumulative output and stop_reason on message_delta — which is
 * where the routes read them, because a turn the learner interrupted has no
 * finalMessage() to ask afterwards.
 */
function streams(text: string, stop_reason = "end_turn") {
  const half = Math.ceil(text.length / 2)
  stream.mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield {
        type: "message_start",
        message: { usage: { ...USAGE, output_tokens: 1 } },
      }
      for (const chunk of [text.slice(0, half), text.slice(half)]) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: chunk } }
      }
      yield {
        type: "message_delta",
        delta: { stop_reason },
        usage: { output_tokens: USAGE.output_tokens },
      }
    },
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
}

const A_PLAN = JSON.stringify({
  pages: [
    {
      title: "Why limit",
      summary: "the problem",
      question: "what breaks?",
      kind: "concept",
    },
    {
      title: "Token bucket",
      summary: "the mechanism",
      question: "how?",
      kind: "algorithm",
    },
  ],
})

beforeEach(() => {
  vi.clearAllMocks()
  currentUser = APPROVED
  limitRow = { user_micros: "0", global_micros: "0", recent: 0 }
  inserted.length = 0
  // logUsage writes a line per call, which is wanted in production and noise here.
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("the gate, on every route that spends money", () => {
  // Written as a table rather than per route because the failure it is for is
  // a new route landing without the guard, and a table is the only shape where
  // adding the route to this file and forgetting the guard cannot both happen
  // quietly. `speak` is here for the same reason it is guarded: it is the only
  // route that bills OpenAI rather than Anthropic, which is exactly how a route
  // gets overlooked.
  // Valid bodies, even though none of them is ever parsed — the refusal happens
  // first, which is the property being asserted. A body that would 400 anyway
  // would make these tests pass for the wrong reason.
  const ROUTES: [string, (req: Request) => Promise<Response>, unknown][] = [
    ["/api/plan", plan, { topic: "closures" }],
    ["/api/board", board, { topic: "closures", page: PAGE }],
    [
      "/api/teach",
      teach,
      { topic: "closures", pages: [PAGE], currentIndex: 0, board: BOARD },
    ],
    ["/api/draw-panel", drawPanel, { title: "A", what: "b" }],
    ["/api/speak", speak, { text: "hello" }],
  ]

  for (const [name, route, body] of ROUTES) {
    it(`${name} refuses a caller who is not signed in`, async () => {
      currentUser = null
      const res = await post(route, body)
      expect(res.status).toBe(401)
      expect(create).not.toHaveBeenCalled()
      expect(stream).not.toHaveBeenCalled()
    })

    it(`${name} refuses a caller still waiting for approval`, async () => {
      currentUser = { ...APPROVED, status: "pending" }
      const res = await post(route, body)
      expect(res.status).toBe(403)
      expect(create).not.toHaveBeenCalled()
      expect(stream).not.toHaveBeenCalled()
    })

    it(`${name} answers 429 when the caller is over the rate limit`, async () => {
      limitRow = { ...limitRow, recent: RATE_LIMIT }
      const res = await post(route, body)
      expect(res.status).toBe(429)
      // The header is the difference between a client that backs off and one
      // that hammers: this limit clears on its own, and says when.
      expect(res.headers.get("Retry-After")).toBe("60")
      expect(create).not.toHaveBeenCalled()
      expect(stream).not.toHaveBeenCalled()
    })

    it(`${name} answers 402 when the global ceiling has tripped`, async () => {
      limitRow = { ...limitRow, global_micros: String(GLOBAL_CAP_MICROS) }
      const res = await post(route, body)
      // 402, not 429: retrying changes nothing until the month does, and a
      // client that treats this as "slow down" would retry forever.
      expect(res.status).toBe(402)
      expect(res.headers.get("Retry-After")).toBeNull()
      expect(create).not.toHaveBeenCalled()
      expect(stream).not.toHaveBeenCalled()
    })

    it(`${name} answers 402 when this caller is over their own cap`, async () => {
      limitRow = { ...limitRow, user_micros: String(USER_CAP_MICROS) }
      const res = await post(route, body)
      expect(res.status).toBe(402)
      expect(create).not.toHaveBeenCalled()
      expect(stream).not.toHaveBeenCalled()
    })
  }
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
    replies(
      JSON.stringify({
        pages: [{ title: "T", summary: "s", question: "q", kind: "concept" }],
      }),
    )
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
    expect(
      got
        .filter((f) => f.event === "text")
        .map((f) => JSON.parse(f.data).delta)
        .join(""),
    ).toBe('{"type":"speak","text":"Hello."}\n{"type":"done"}\n')
  })

  it("turns a mid-stream failure into an error frame, not a truncated lesson", async () => {
    // Half a turn arrives, then the upstream dies. The client reads this frame
    // and says so; before it existed, the page was left half-taught in silence.
    stream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: '{"type":"speak"' },
        }
        throw new Error("upstream went away")
      },
    })

    const got = await frames(await post(teach, body))
    expect(got[got.length - 1].event).toBe("error")
    expect(JSON.parse(got[got.length - 1].data).message).toBe("upstream went away")
  })

  it("turns a page cut off at max_tokens into an error frame, not a taught page", async () => {
    // Thinking and text share the max_tokens budget, so a turn can run out of
    // room and still end *cleanly* on the wire. The error frame is what stops
    // the client marking the page taught with half its beats — the hook test
    // covers that an error frame never marks a page taught.
    streams('{"type":"speak","text":"Hello."}\n', "max_tokens")
    const got = await frames(await post(teach, body))
    expect(got[got.length - 1].event).toBe("error")
    expect(got.map((f) => f.event)).not.toContain("end")
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
  const body = {
    title: "The bucket",
    note: "",
    what: "the bucket holding tokens",
    existing: [],
  }

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

  it("says when the drawing ran out of room instead of pretending it finished", async () => {
    // The line parser drops a trailing partial line by design, so truncation
    // used to be indistinguishable from the model simply drawing less.
    streams('{"kind":"note","text":"one","color":"black"}\n', "max_tokens")
    const got = await frames(await post(drawPanel, body))
    expect(got.map((f) => f.event)).toEqual(["block", "error"])
  })

  it("drops a stack heading that only repeats the panel title", async () => {
    streams(
      '{"kind":"stack","label":"The Bucket","items":[{"text":"token","color":"black"}]}\n',
    )
    const got = await frames(await post(drawPanel, body))
    expect(JSON.parse(got[0].data).label).toBeUndefined()
  })

  it("rejects existing content that is not blocks", async () => {
    // `existing` is stringified into the prompt, so anything accepted here is
    // something a caller got to put in front of the model.
    const res = await post(drawPanel, {
      ...body,
      existing: [{ kind: "sql", text: "drop" }],
    })
    expect(res.status).toBe(400)
    expect(stream).not.toHaveBeenCalled()
  })
})

describe("what the spend cap will later read", () => {
  // `lib/limits.ts` sums usage_event, so a call that lands no row here is a
  // call that is free forever as far as every cap is concerned. That makes
  // these the tests standing between the cap and a lie.

  it("records a Claude call against the caller who made it", async () => {
    replies(A_PLAN)
    await post(plan, { topic: "rate limiting" })

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      route: "plan",
      userId: "u_test",
      model: "claude-opus-5",
      inputTokens: USAGE.input_tokens,
      outputTokens: USAGE.output_tokens,
    })
    expect(inserted[0].costMicros).toBeGreaterThan(0)
  })

  it("records a streaming call from the stream's own events", async () => {
    // Usage rides message_start and message_delta and is folded in as it
    // passes. finalMessage() only exists for a turn that finished — and the
    // turn most worth recording is the one the learner interrupted.
    streams("hello there")
    // The body has to be drained first: the generator that calls the model —
    // and then records what it cost — does not run until something reads it.
    await frames(
      await post(teach, {
        topic: "closures",
        pages: [PAGE],
        currentIndex: 0,
        board: BOARD,
      }),
    )
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ route: "teach", userId: "u_test" })
    expect(inserted[0].costMicros).toBeGreaterThan(0)
  })

  it("records a turn the learner interrupted, and aborts it upstream", async () => {
    // Asking a question aborts /api/teach mid-stream — routine, not
    // exceptional. The mock hangs after two events until the signal the route
    // now passes upstream fires, the way a real SDK read settles when the
    // request is torn down. Two things are being asserted: the abort reaches
    // the model call (so it stops generating on our bill), and the spend
    // still lands in usage_event — an interrupted turn used to record
    // nothing, making it free as far as both caps were concerned.
    let sawAbort = false
    stream.mockImplementation((_params: unknown, opts: { signal?: AbortSignal }) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "message_start", message: { usage: USAGE } }
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: '{"type":"speak"' },
        }
        await new Promise<never>((_, reject) => {
          const abort = () => {
            sawAbort = true
            reject(new Error("Request was aborted."))
          }
          if (opts.signal?.aborted) abort()
          else opts.signal?.addEventListener("abort", abort, { once: true })
        })
      },
    }))

    const interrupt = new AbortController()
    const res = await teach(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: "closures",
          pages: [PAGE],
          currentIndex: 0,
          board: BOARD,
        }),
        signal: interrupt.signal,
      }),
    )
    expect(res.status).toBe(200)

    const reading = frames(res)
    interrupt.abort()
    await reading

    expect(sawAbort).toBe(true)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      route: "teach",
      inputTokens: USAGE.input_tokens,
    })
  })

  it("records narration, which bills a different vendor entirely", async () => {
    // The route most likely to be forgotten by a spend cap: it is the only one
    // that does not call Anthropic, so it is the only one with no `usage`
    // object to notice the absence of.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("audio", { status: 200 })),
    )
    const text = "a sentence of narration"
    const res = await post(speak, { text })
    expect(res.status).toBe(200)

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      route: "speak",
      model: "gpt-4o-mini-tts",
      costMicros: text.length * TTS_MICROS_PER_CHAR,
      // Zero on purpose: OpenAI does not bill this per token in any unit this
      // route can see, and inventing one would put a fiction in a column named
      // for a fact.
      inputTokens: 0,
      outputTokens: 0,
    })
    vi.unstubAllGlobals()
  })

  it("still answers the learner when the usage insert fails", async () => {
    // The call has already happened and been paid for. Failing the response too
    // would cost the learner their page and refund nobody — so it is logged as
    // an under-count and the page is served.
    const boom = vi.spyOn(console, "log")
    inserted.push = () => {
      throw new Error("neon is down")
    }
    replies(A_PLAN)
    const res = await post(plan, { topic: "rate limiting" })
    expect(res.status).toBe(200)
    expect(boom.mock.calls.some(([line]) => String(line).includes("under-count"))).toBe(
      true,
    )
    inserted.push = Array.prototype.push
  })
})
