import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

// Who is allowed to spend this project's API budget, asked in one place.
//
// The redirect in proxy.ts is not this check and cannot be. That layer sees a
// cookie, not a session — it cannot tell approved from pending without a
// database round trip, and Next.js's edge hook has a history of being
// bypassable by a crafted header, so treating it as the security boundary would
// be a mistake even if it could. It exists to save a signed-out visitor a
// wasted page load. This is the part that says no.

export interface Learner {
  id: string
  email: string
  role: "user" | "admin"
}

export type Gate = { ok: true; user: Learner } | { ok: false; response: NextResponse }

/** The reason, in words a learner can act on rather than a status code. */
const DENIED: Record<"pending" | "rejected", string> = {
  pending:
    "Your account is waiting for approval. You will get an email when it is ready.",
  rejected: "Your account was not approved for this app.",
}

/**
 * Resolves the caller, or the response to return instead.
 *
 * Shaped like `readBody` in lib/request.ts on purpose — `if (!gate.ok) return
 * gate.response` reads the same in every route, and TypeScript narrows to a
 * real user on the line after, so there is no way to use the caller without
 * having handled the refusal.
 */
export async function requireApproved(): Promise<Gate> {
  const session = await auth()
  const user = session?.user

  if (!user?.id || !user.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }),
    }
  }

  if (user.status !== "approved") {
    return {
      ok: false,
      // 403, not 401: signing in again would change nothing, and a client that
      // treats this as "your session expired" would loop them through Google
      // forever.
      response: NextResponse.json({ error: DENIED[user.status] }, { status: 403 }),
    }
  }

  return { ok: true, user: { id: user.id, email: user.email, role: user.role } }
}
