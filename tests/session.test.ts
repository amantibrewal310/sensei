import { describe, expect, it } from "vitest"
import { MAX_TRANSCRIPT, TRANSCRIPT_WINDOW } from "@/lib/lesson"
import { remember, type Msg } from "@/hooks/useTeachingSession"

const say = (text: string): Msg => ({ role: "assistant", text })

describe("remember", () => {
  it("keeps the transcript inside the window", () => {
    const transcript: Msg[] = []
    for (let i = 0; i < TRANSCRIPT_WINDOW * 3; i++) remember(transcript, say(`${i}`))
    expect(transcript).toHaveLength(TRANSCRIPT_WINDOW)
  })

  it("drops the oldest, so the newest question is never the one lost", () => {
    const transcript: Msg[] = []
    for (let i = 0; i < TRANSCRIPT_WINDOW; i++) remember(transcript, say(`${i}`))
    remember(transcript, { role: "user", text: "wait, why?" })

    expect(transcript[transcript.length - 1].text).toBe("wait, why?")
    expect(transcript[0].text).toBe("1") // "0" fell off the front
  })

  it("stays under the route's own bound", () => {
    // Not a tautology: /api/teach rejects a longer transcript outright, so if
    // these two ever cross, every lesson past its third page answers 400 — and
    // it would first be seen in the middle of a demo, not here. A measured page
    // emits seven spoken lines, which is how few pages that takes.
    expect(TRANSCRIPT_WINDOW).toBeLessThan(MAX_TRANSCRIPT)
  })
})
