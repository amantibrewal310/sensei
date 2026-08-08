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
// are secrets, and there are no NEXT_PUBLIC_ variables in this app by design.
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  // The pooled Neon URL — the one whose host contains "-pooler". Migrations use
  // DATABASE_URL_UNPOOLED instead, but drizzle-kit reads that from .env.local
  // itself and never runs inside the app, so it is not validated here.
  DATABASE_URL: z.string().min(1).startsWith("postgres"),
})

export type Env = z.infer<typeof EnvSchema>

/** What each variable is for, so the failure tells you where to go get it. */
const PURPOSE: Record<keyof Env, string> = {
  ANTHROPIC_API_KEY: "planning, teaching, and panel layout",
  OPENAI_API_KEY: "narration (text-to-speech)",
  DATABASE_URL: "accounts, approvals, and the spend cap",
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
