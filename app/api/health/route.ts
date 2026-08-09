// The one route under app/api that is deliberately NOT wrapped in withGuard.
//
// It exists for an uptime monitor, which has no session and must be able to ask
// "are you up" without being answered 401 — and without tripping the rate
// limit it would otherwise be polling against. That is safe only because this
// route spends nothing and reads nothing: no model, no database, no body. A
// health check that queries Neon reports Neon's health, not the app's, and one
// that costs anything is one an attacker can make cost more. The exemption is
// recorded in tests/routes.test.ts next to the guard table it is absent from.

export const runtime = "nodejs"
// Never static: the monitor is asking whether the deployment answers right
// now, and a 200 cached at build time answers a different question.
export const dynamic = "force-dynamic"

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    // Which build is answering. "dev" outside Vercel, where no sha exists —
    // the same stamp instrumentation.ts writes to the boot log line.
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  })
}
