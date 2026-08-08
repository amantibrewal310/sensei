import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkLimits } from "@/lib/limits"

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
  pending: "Your account is waiting for approval. Reload once it has been granted.",
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

/**
 * Everything a route must be true before it is allowed to spend anything, in
 * one wrapper so that a route added later cannot quietly skip it.
 *
 * The order is deliberate and is cheapest-first: the session is already needed
 * to know who to bill, the limit check is one query, and only then does the
 * handler get to read a body or call a model. Nothing below this line is free.
 *
 * `route` is the name that ends up in `usage_event.route`, and the handler is
 * handed the caller so it has something to attribute the spend to — which is
 * what makes forgetting to record usage awkward rather than easy.
 */
export function withGuard(
  route: string,
  handler: (req: Request, user: Learner) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const gate = await requireApproved()
    if (!gate.ok) return gate.response

    const denial = await checkLimits(gate.user.id)
    if (denial) {
      console.log(
        JSON.stringify({ at: "limit", route, user: gate.user.id, why: denial.reason }),
      )
      return NextResponse.json(
        { error: denial.reason },
        {
          // 429 for the limit that clears on its own, 402 for the ones that do
          // not. A client retrying a 402 is a client that will retry forever.
          status: denial.retryable ? 429 : 402,
          ...(denial.retryable ? { headers: { "Retry-After": "60" } } : {}),
        },
      )
    }

    return handler(req, gate.user)
  }
}

/**
 * The signed-in administrator, or a throw.
 *
 * For **server actions**, which are the reason this exists in this shape. A
 * server action is a POST endpoint with a generated name — not a private
 * function, however much it reads like one where it is defined. Anything that
 * can guess the name can call it, so "only the admin page renders this button"
 * is not a check. Approving your own account is one unguarded action away.
 *
 * It throws rather than returning a union because there is no sensible way for
 * a caller to continue: the action's whole purpose was the thing being refused.
 */
export async function assertAdmin(): Promise<Learner> {
  const user = (await auth())?.user

  if (!user?.id || !user.email || user.role !== "admin" || user.status !== "approved") {
    throw new Error("not authorised")
  }

  return { id: user.id, email: user.email, role: user.role }
}
