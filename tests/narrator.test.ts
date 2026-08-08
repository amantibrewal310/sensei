import { afterEach, describe, expect, it, vi } from "vitest"
import { Narrator } from "@/lib/narrator"

/**
 * Stands in for `/api/speak`. Never resolves on its own — a request is only
 * finished here by being aborted, which is the thing under test.
 */
function stubSpeak(): { signals: AbortSignal[] } {
  const signals: AbortSignal[] = []
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal
    signals.push(signal)
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    })
  })
  return { signals }
}

afterEach(() => vi.unstubAllGlobals())

describe("Narrator.stop", () => {
  it("aborts the requests still in flight", async () => {
    const { signals } = stubSpeak()
    const narrator = new Narrator()

    // Prefetching runs ahead of the voice, so several sentences are typically
    // being synthesised at the moment the learner cuts in.
    narrator.prefetch("one")
    narrator.prefetch("two")
    narrator.prefetch("three")
    expect(signals).toHaveLength(3)
    expect(signals.every((s) => s.aborted)).toBe(false)

    narrator.stop()
    expect(signals.every((s) => s.aborted)).toBe(true)
  })

  it("leaves the next lesson able to speak", async () => {
    // The failure this guards is silent and total: an aborted signal stays
    // aborted, so reusing one controller would kill every later sentence the
    // moment it was requested, and the app has no way to notice — a lesson with
    // no audio looks exactly like a lesson the browser refused to play.
    const { signals } = stubSpeak()
    const narrator = new Narrator()

    narrator.prefetch("one")
    narrator.stop()
    narrator.prefetch("two")

    expect(signals).toHaveLength(2)
    expect(signals[1].aborted).toBe(false)
  })

  it("does not re-synthesise a line already being fetched", async () => {
    const { signals } = stubSpeak()
    const narrator = new Narrator()

    narrator.prefetch("one")
    narrator.prefetch("one")

    expect(signals).toHaveLength(1)
  })
})
