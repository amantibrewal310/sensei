import { requireSignedIn } from "@/lib/guard"
import { Report } from "@/lib/report"
import { readBody } from "@/lib/request"

export const runtime = "nodejs"

// Where a broken browser gets to say so.
//
// The teaching loop runs in a browser nobody operates, and until this route
// existed its failures ended at setError — visible to the one learner watching
// and to nobody else. Landing them in the server log puts them in the same
// stream the drain and its alerts already watch (docs/setup.md §5), which is
// the whole consumer story: one pipeline, not a second vendor.
//
// Signed-in, but deliberately NOT withGuard. It spends nothing — no model, no
// database — and the moments it exists for include exactly the ones where the
// guard says no: a learner over their cap whose lesson then breaks is a report
// worth having, not a 402. The session requirement is what keeps it from being
// an anonymous log-injection endpoint; the size caps below are what bound a
// signed-in flood to log lines. Its exemption from the guard table is recorded
// in tests/routes.test.ts.

export async function POST(req: Request): Promise<Response> {
  const gate = await requireSignedIn()
  if (!gate.ok) return gate.response

  const body = await readBody(req, Report)
  if (!body.ok) return body.response

  console.log(
    JSON.stringify({
      at: "client-error",
      user: gate.user.id,
      where: body.data.where,
      message: body.data.message,
      digest: body.data.digest,
      stack: body.data.stack,
    }),
  )

  return new Response(null, { status: 204 })
}
