/**
 * Where to send someone after sign-in, given a `next` they do not control the
 * meaning of.
 *
 * It arrives in a query string, so it is attacker-supplied: a link to
 * `/login?next=//evil.example` sends a real user through a real Google sign-in
 * and lands them somewhere else entirely, which is the shape of a convincing
 * phishing flow. The naive check is `startsWith("/")`, and it is exactly the
 * one that lets `//evil.example` through, because a browser reads a
 * protocol-relative URL as another host.
 *
 * Anything that is not plainly a path on this site becomes the home page.
 * Lives here rather than in the login page so it can be tested without
 * rendering anything.
 */
export function safeNext(next: string | undefined | null): string {
  if (!next?.startsWith("/")) return "/"
  // Backslash because browsers have historically normalised it to a slash, so
  // `/\evil.example` is another spelling of the protocol-relative case.
  if (next.startsWith("//") || next.startsWith("/\\")) return "/"
  return next
}

/**
 * An absolute URL for this app, for the places a relative one is useless — a
 * link inside an email being the only one so far.
 *
 * Deliberately not a required environment variable. Vercel sets `VERCEL_URL`
 * on every deployment, `AUTH_URL` is the override for anywhere that is not
 * Vercel, and localhost covers development — so the common cases need no
 * configuration and the uncommon one has a door.
 */
export function appUrl(path: string): string {
  const base =
    process.env.AUTH_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  return new URL(path, base).toString()
}
