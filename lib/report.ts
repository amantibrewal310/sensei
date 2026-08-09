// The browser half of {"at":"client-error"} — see app/api/client-error/route.ts.
//
// Called from the two seams where a client-side *bug* surfaces: the error
// boundary, and the catch in runFrom/replay. Every other failure the client
// shows (a 4xx, a dropped connection, a dead stream) was already visible in a
// server log; these two were not, and the tldraw disposal crash shipped
// through exactly that blindness.

/** Truncated to the route's own zod bounds, so a long stack cannot turn a report into a 400. */
const MESSAGE_MAX = 2000
const STACK_MAX = 8000
const DIGEST_MAX = 128

export function reportClientError(where: string, error: unknown, digest?: string): void {
  const message =
    (error instanceof Error ? error.message : String(error)) || "unknown error"
  const stack = error instanceof Error ? error.stack?.slice(0, STACK_MAX) : undefined

  // Fire-and-forget by design: the learner has already been shown the error
  // this is reporting, and a failed report must not manufacture a second one.
  // keepalive lets the request survive the navigation that often follows a
  // crash.
  try {
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        where,
        message: message.slice(0, MESSAGE_MAX),
        stack,
        digest: digest?.slice(0, DIGEST_MAX),
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // A fetch that throws synchronously (a test stub, an exotic runtime) must
    // not turn the bug being reported into a second one at the report site.
  }
}
