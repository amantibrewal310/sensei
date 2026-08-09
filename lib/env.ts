import { z } from "zod"

// Every environment variable the server needs, checked once when this module is
// first imported rather than at the point of use.
//
// The failure this exists to prevent is specific. `app/api/speak/route.ts`
// interpolated the key straight into a header, so an unset OPENAI_API_KEY sent
// the literal string `Bearer undefined` to OpenAI, came back 401, and surfaced
// as a generic "speech synthesis failed: 401" that named neither the variable
// nor the fact that it was missing. A key you forgot to set should say so.
//
// Server-only. Nothing here may be imported from a "use client" module — these
// are secrets. The one exception to "no NEXT_PUBLIC_ variables" is the tldraw
// license key, which is public by design and therefore lives with the
// component that ships it to the browser — see components/Board.tsx.
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  // The pooled Neon URL — the one whose host contains "-pooler". Migrations use
  // DATABASE_URL_UNPOOLED instead, but drizzle-kit reads that from .env.local
  // itself and never runs inside the app, so it is not validated here.
  DATABASE_URL: z.string().min(1).startsWith("postgres"),
  // Signs the session cookie. `npx auth secret` emits 44 base64 characters; the
  // bound is here because a short hand-typed value is the one mistake that
  // produces no error at all — just sessions that are trivially forgeable.
  AUTH_SECRET: z.string().min(32),
  // Google's own documented format. The console shows several long strings on
  // the same screen and only this one ends in the suffix, so checking it turns
  // "pasted the project number" into a boot failure that says which field.
  AUTH_GOOGLE_ID: z.string().endsWith(".apps.googleusercontent.com"),
  AUTH_GOOGLE_SECRET: z.string().min(10),
  // Who gets in without waiting for approval, matched on the address Google
  // returns. Checked on every sign-in rather than only at account creation —
  // see the `signIn` event in lib/auth.ts for why that difference matters.
  ADMIN_EMAIL: z.email(),
  // Resend. The prefix is their own format, and checking it catches the usual
  // slip of pasting the key's *name* from the dashboard list rather than the
  // key, which is only visible once.
  RESEND_API_KEY: z.string().startsWith("re_"),
})

export type Env = z.infer<typeof EnvSchema>

/** What each variable is for, so the failure tells you where to go get it. */
const PURPOSE: Record<keyof Env, string> = {
  ANTHROPIC_API_KEY: "planning, teaching, and panel layout",
  OPENAI_API_KEY: "narration (text-to-speech)",
  DATABASE_URL: "accounts, approvals, and the spend cap",
  AUTH_SECRET: "signing the session cookie — `npx auth secret`",
  AUTH_GOOGLE_ID: "the Google sign-in button — see docs/setup.md §3",
  AUTH_GOOGLE_SECRET: "the Google sign-in button — see docs/setup.md §3",
  ADMIN_EMAIL: "the account that approves everyone else",
  RESEND_API_KEY: "telling you that someone is waiting for approval",
}

function load(): Env {
  // `next build` imports every route module to collect page data, and a CI
  // build has no secrets. Validating there would fail the build for a reason
  // that has nothing to do with whether the code compiles.
  if (process.env.SKIP_ENV_VALIDATION) return process.env as unknown as Env

  const parsed = EnvSchema.safeParse(process.env)
  if (parsed.success) return parsed.data

  // Report by variable name, not by zod's default wording. A missing key and an
  // empty one raise different issue types — "expected string, received
  // undefined" names neither the variable nor what it was needed for, which is
  // the exact uselessness this module was added to remove.
  const problems = parsed.error.issues
    .map((issue) => {
      const key = String(issue.path[0] ?? "")
      const state = process.env[key] === undefined ? "is not set" : "is empty"
      const purpose = PURPOSE[key as keyof Env]
      return `  - ${key} ${state}${purpose ? ` — needed for ${purpose}` : ""}`
    })
    .join("\n")

  throw new Error(
    `Missing or invalid environment variables:\n${problems}\n\n` +
      `Copy .env.local.example to .env.local and fill it in.`,
  )
}

export const env = load()
