// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { useTeachingSession } from "@/hooks/useTeachingSession"
import type { CanvasApi } from "@/components/Board"
import { BOARD } from "./fixtures"

// The generation counter is the subtlest thing in this app and the only part of
// it with a bug in the history: two turns ran concurrently and the lesson
// advanced twice. Nothing has protected it since. These tests hold a teaching
// stream open on purpose, so a turn can be superseded exactly where that
// happened — while the model is still talking.

const PLAN = {
  pages: [
    {
      id: "page-1",
      title: "Token bucket",
      summary: "permits",
      question: "how?",
      kind: "algorithm",
    },
    {
      id: "page-2",
      title: "Leaky bucket",
      summary: "a queue",
      question: "how?",
      kind: "algorithm",
    },
  ],
}

const BLOCK = '{"kind":"note","text":"a token","color":"black"}'

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

/** An SSE body this test writes into by hand, so a turn can be caught mid-stream. */
function openStream() {
  let push!: (chunk: string) => void
  let close!: () => void
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          // The reader has let go of this stream, which is what a superseded
          // turn is supposed to do — writing into it is then a no-op, not a
          // test failure.
        }
      }
      close = () => {
        try {
          controller.close()
        } catch {
          // Already closed by the reader letting go. Same reason as above.
        }
      }
    },
  })
  return { body, push, close, response: new Response(body, { status: 200 }) }
}

function sse(...chunks: string[]): Response {
  const s = openStream()
  for (const chunk of chunks) s.push(chunk)
  s.close()
  return s.response
}

/** The teacher's NDJSON, wrapped as the `text` frames the route emits. */
const teacherSays = (...lines: string[]) =>
  lines.map((line) => frame("text", { delta: `${line}\n` })).join("") + frame("end", {})

/**
 * Long enough for the fetches, the stream reads and the hook's own pacing to
 * finish. The lesson runs on real timers — `LEAD_MS` and `SHAPE_MS` are what
 * make speech and drawing land in step, so faking them would be faking the
 * thing under test.
 */
const settle = () => new Promise((r) => setTimeout(r, 60))

function stubCanvas() {
  const api: CanvasApi = {
    openPage: vi.fn(),
    applyLayout: vi.fn(),
    syncPanel: vi.fn(),
    addConnector: vi.fn(),
    focus: vi.fn(),
    fitAll: vi.fn(),
  }
  return { current: api }
}

/** Routes each fetch by path, so a test only names the ones it cares about. */
let routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>

beforeEach(() => {
  routes = {
    "/api/plan": () => Response.json(PLAN),
    "/api/board": () => Response.json(BOARD),
    "/api/teach": () =>
      sse(
        teacherSays(
          '{"type":"speak","text":"Hello."}',
          '{"type":"draw","panel":"bucket","what":"the bucket"}',
          '{"type":"done"}',
        ),
      ),
    "/api/draw-panel": () => sse(frame("block", JSON.parse(BLOCK)), frame("done", {})),
    // Narration is not what these tests are about, and a failure to synthesise
    // is already treated as silence — which keeps `Audio` out of jsdom's way.
    "/api/speak": () => new Response(null, { status: 502 }),
    // Error reporting is fire-and-forget from the hook's catch blocks; a test
    // that cares overrides this to capture the body, the rest must not fail
    // with "unexpected fetch" merely because something crashed as arranged.
    "/api/client-error": () => new Response(null, { status: 204 }),
  }
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const route = routes[new URL(url, "http://localhost").pathname]
    if (!route) throw new Error(`unexpected fetch: ${url}`)
    return Promise.resolve(route(init))
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("useTeachingSession", () => {
  it("teaches a page and marks it taught", async () => {
    const canvas = stubCanvas()
    const { result } = renderHook(() => useTeachingSession(canvas))

    await act(() => result.current.start("rate limiting"))

    await waitFor(() => expect(result.current.taught).toContain("page-1"))
    expect(canvas.current.openPage).toHaveBeenCalledWith(
      "page-1",
      "Token bucket",
      expect.anything(),
    )
    expect(canvas.current.syncPanel).toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })

  it("does not mark a page taught when its turn was superseded", async () => {
    // The shape of the bug that was: the learner interrupts, a new turn starts,
    // and the abandoned one runs to the end of its own function anyway —
    // marking the page taught and advancing the lesson a second time.
    const held = openStream()
    let turns = 0
    // The replacement turn is left open on purpose. Nothing but the abandoned
    // turn can mark this page taught, so the assertion has only one possible
    // author.
    routes["/api/teach"] = () => (turns++ === 0 ? held.response : openStream().response)

    const canvas = stubCanvas()
    const { result } = renderHook(() => useTeachingSession(canvas))

    // `start` does not resolve until the whole lesson has been taught, and this
    // one never will — so it is deliberately not awaited.
    await act(async () => {
      void result.current.start("rate limiting")
      await settle()
    })
    expect(canvas.current.openPage).toHaveBeenCalled()

    // The teacher is mid-sentence. Cut in.
    held.push(frame("text", { delta: '{"type":"speak","text":"Hello."}\n' }))
    await act(async () => {
      result.current.ask("wait, why?")
      await settle()
    })

    // Only now does the abandoned stream finish. It must change nothing.
    const drawn = () =>
      (canvas.current.syncPanel as ReturnType<typeof vi.fn>).mock.calls.length
    const before = drawn()
    held.push(
      frame("text", {
        delta: '{"type":"draw","panel":"bucket","what":"the bucket"}\n{"type":"done"}\n',
      }) + frame("end", {}),
    )
    held.close()
    await act(() => settle())

    expect(result.current.taught).not.toContain("page-1")
    expect(drawn()).toBe(before)
  })

  it("surfaces the message a route sends with a failure", async () => {
    routes["/api/plan"] = () =>
      Response.json({ error: "topic declined" }, { status: 422 })

    const { result } = renderHook(() => useTeachingSession(stubCanvas()))
    await act(() => result.current.start("something declined"))

    expect(result.current.error).toBe("topic declined")
    expect(result.current.status).toBe("idle")
  })

  it("surfaces a stream that dies halfway instead of teaching half a page", async () => {
    routes["/api/teach"] = () =>
      sse(
        frame("text", { delta: '{"type":"speak","text":"Hello."}\n' }),
        frame("error", { message: "upstream went away" }),
      )

    const canvas = stubCanvas()
    const { result } = renderHook(() => useTeachingSession(canvas))
    await act(() => result.current.start("rate limiting"))

    await waitFor(() => expect(result.current.error).toBe("upstream went away"))
    // Half a lesson is not a taught page, and the outline must not claim it is.
    expect(result.current.taught).not.toContain("page-1")
  })

  it("reports a client bug to the server before showing it", async () => {
    // The catch in runFrom is where a bug in this code surfaces — the canvas
    // throwing from a disposed editor was the last real one. It used to end at
    // setError, in a browser nobody operates; now the same throw also lands in
    // the server log, so both halves are asserted: the learner sees it, and
    // the report leaves the machine.
    const reports: string[] = []
    routes["/api/client-error"] = (init) => {
      reports.push(String(init?.body))
      return new Response(null, { status: 204 })
    }

    const canvas = stubCanvas()
    ;(canvas.current.openPage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("editor was disposed")
    })

    const { result } = renderHook(() => useTeachingSession(canvas))
    await act(() => result.current.start("rate limiting"))

    await waitFor(() => expect(result.current.error).toContain("editor was disposed"))
    expect(result.current.status).toBe("idle")

    await waitFor(() => expect(reports).toHaveLength(1))
    expect(JSON.parse(reports[0])).toMatchObject({
      where: "teaching-loop",
      message: "editor was disposed",
    })
  })

  it("does not leave a page marked taught when its drawing failed", async () => {
    // The silent-success case: /api/draw-panel answers 500, the panel stays
    // empty, and the page used to be ticked off as though it had been taught.
    routes["/api/draw-panel"] = () =>
      Response.json({ error: "the model is down" }, { status: 500 })

    const { result } = renderHook(() => useTeachingSession(stubCanvas()))
    await act(() =>
      result.current
        .start("rate limiting")
        .then(() => new Promise((r) => setTimeout(r, 50))),
    )

    expect(result.current.error).toBe("the model is down")
  })
})
