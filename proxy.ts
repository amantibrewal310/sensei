import { NextResponse, type NextRequest } from "next/server"

// Next 16 renamed this convention from `middleware` to `proxy` — same hook,
// same signature, and the old filename still works while warning that it will
// not forever.
//
// A signed-out visitor should not watch /learn render and then fail on its
// first fetch. That is all this does.
//
// It deliberately does not call `auth()`. Doing so would mean a database round
// trip on every matched request just to learn something the page is about to
// look up anyway, and — more to the point — middleware is not where this app's
// authorisation lives. `lib/guard.ts` is, because it runs inside the request
// that spends the money. A cookie here is a hint, not a credential: it proves
// nothing about approval, and it is checked again by code that can be sure.

// Auth.js names the cookie by whether the connection is secure, so both
// spellings exist and which one you get depends on the deployment.
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"]

export function proxy(req: NextRequest) {
  if (SESSION_COOKIES.some((name) => req.cookies.has(name))) return NextResponse.next()

  const login = new URL("/login", req.url)
  login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.redirect(login)
}

export const config = {
  // Pages only. An API route must answer a fetch with JSON it can display —
  // redirecting one to /login hands the client an HTML page where it expected
  // `{error}`, which surfaces as a parse failure naming nothing. Those routes
  // guard themselves.
  matcher: ["/learn/:path*", "/admin/:path*"],
}
