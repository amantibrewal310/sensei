import { env } from "@/lib/env"

// One POST to one endpoint, so there is no SDK here — the same reasoning that
// has app/api/speak/route.ts calling OpenAI with fetch.
//
// The sender is Resend's shared address, which has a hard constraint worth
// knowing before wondering why a message vanished: without a verified domain it
// will only deliver to the address the Resend account was opened with. That is
// exactly enough for this app, because the only person it ever writes to is the
// administrator. It is also why nothing here emails a *learner* — see the
// comment on the pending page.
const FROM = "sensei <onboarding@resend.dev>"

interface Mail {
  subject: string
  text: string
}

/**
 * Sends to ADMIN_EMAIL, and never throws.
 *
 * Every caller is a side effect of something more important than itself — a
 * person signing in, an approval being granted. Failing that operation because
 * a notification bounced would be the tail wagging the dog, so a failure is
 * logged in the same shape as `lib/usage.ts` and swallowed.
 */
export async function mailAdmin({ subject, text }: Mail): Promise<void> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [env.ADMIN_EMAIL], subject, text }),
    })
    if (!res.ok) {
      // The body is where Resend says *why*, and the most likely why is the
      // shared-sender restriction above — a 403 naming the address it refused.
      console.log(
        JSON.stringify({
          at: "email",
          ok: false,
          status: res.status,
          detail: await res.text().catch(() => ""),
        }),
      )
      return
    }
    console.log(JSON.stringify({ at: "email", ok: true, subject }))
  } catch (err) {
    console.log(JSON.stringify({ at: "email", ok: false, error: String(err) }))
  }
}

/** Someone signed in for the first time and is now sitting in the queue. */
export function mailSignup(who: { name?: string | null; email: string }, url: string) {
  return mailAdmin({
    subject: `sensei: ${who.email} is waiting for approval`,
    text: [
      `${who.name ?? "Someone"} <${who.email}> signed in to sensei and is waiting to be approved.`,
      "",
      `Approve or reject them: ${url}`,
      "",
      "Until you do, they cannot start a lesson and cannot spend anything.",
    ].join("\n"),
  })
}
