// The wire between the API routes and the browser, written and read in one file.
//
// The format is three lines and a blank one, which is exactly why the reader
// belongs next to the writer: the `slice(7)` and `slice(6)` below are the
// lengths of the `event: ` and `data: ` prefixes emitted above them. Kept apart,
// those two numbers were a spec re-encoded as character counts at every call
// site — and there were two call sites, both copies of each other.

export interface Frame {
  event: string
  data: unknown
}

const EVENT = "event: "
const DATA = "data: "

export function sseResponse(gen: AsyncGenerator<Frame>): Response {
  const encoder = new TextEncoder()
  // Flipped when the client goes away mid-stream — which is routine, not
  // exceptional: the learner asking a question aborts the in-flight turn.
  // Without `cancel` below, the generator was abandoned at its yield point and
  // its finally blocks never ran — and the routes record what a model call
  // cost in a finally, so every interrupted turn vanished from usage_event
  // and was free as far as both spend caps were concerned.
  let gone = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (gone) return
        try {
          controller.enqueue(
            encoder.encode(`${EVENT}${event}\n${DATA}${JSON.stringify(data)}\n\n`),
          )
        } catch {
          // Cancelled between reads. Stop writing; `cancel` does the cleanup.
          gone = true
        }
      }

      try {
        for await (const { event, data } of gen) {
          // Breaking out of for-await calls gen.return() itself, so the
          // generator's finally runs on this path too.
          if (gone) break
          send(event, data)
        }
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "stream error",
        })
      } finally {
        if (!gone) controller.close()
      }
    },
    async cancel() {
      gone = true
      // Runs the generator's finally blocks. If it is suspended mid-await on
      // the model, the abort signal the routes pass upstream settles that
      // await first — the two halves of one shutdown.
      await gen.return(undefined)
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

/**
 * Reads the other end of `sseResponse`, one frame at a time.
 *
 * `alive` is checked between reads so a superseded turn stops pulling and
 * releases the connection rather than drawing into a lesson the learner has
 * already navigated away from. A network failure mid-stream ends the iteration
 * — a half-received turn is over either way, and every caller treats it as such.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  alive: () => boolean = () => true,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!alive()) break
      buffer += decoder.decode(value, { stream: true })

      const frames = buffer.split("\n\n")
      buffer = frames.pop() ?? ""
      for (const frame of frames) {
        const lines = frame.split("\n")
        const event = lines.find((l) => l.startsWith(EVENT))?.slice(EVENT.length)
        const data = lines.find((l) => l.startsWith(DATA))?.slice(DATA.length)
        if (event && data !== undefined) yield { event, data }
      }
    }
  } catch {
    // The stream died. The caller's turn is over; there is nothing to salvage.
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Reads the `{message}` payload `sseResponse` sends on its `error` frame. */
export function errorFrameMessage(data: string, fallback: string): string {
  try {
    const body = JSON.parse(data) as { message?: unknown }
    return typeof body.message === "string" && body.message ? body.message : fallback
  } catch {
    return fallback
  }
}
