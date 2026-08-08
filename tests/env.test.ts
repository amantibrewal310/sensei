import { describe, expect, it, vi } from "vitest"

// `lib/env` validates at module scope, which is the point of it — so every case
// here needs a fresh module registry and a process.env set up before the
// import, not after.
const MANAGED = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "ADMIN_EMAIL",
  "SKIP_ENV_VALIDATION",
] as const

/** Enough to satisfy the schema, so a case can be about one variable. */
const ALL = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  OPENAI_API_KEY: "sk-openai-test",
  DATABASE_URL: "postgresql://u:p@host.neon.tech/neondb?sslmode=require",
  AUTH_SECRET: "a-secret-long-enough-to-clear-the-32-character-minimum",
  AUTH_GOOGLE_ID: "1234.apps.googleusercontent.com",
  AUTH_GOOGLE_SECRET: "GOCSPX-test-secret",
  ADMIN_EMAIL: "admin@example.com",
}

async function importEnv(vars: Partial<Record<string, string>>) {
  const saved = Object.fromEntries(MANAGED.map((k) => [k, process.env[k]]))
  for (const key of MANAGED) {
    const value = vars[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
  try {
    return await import("../lib/env")
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("env", () => {
  it("reads every variable when they are all set", async () => {
    const { env } = await importEnv(ALL)
    expect(env.ANTHROPIC_API_KEY).toBe(ALL.ANTHROPIC_API_KEY)
    expect(env.OPENAI_API_KEY).toBe(ALL.OPENAI_API_KEY)
    expect(env.DATABASE_URL).toBe(ALL.DATABASE_URL)
  })

  it("names the variable that is missing", async () => {
    // The whole point: the old code sent `Bearer undefined` to OpenAI and came
    // back with a 401 that mentioned neither the variable nor that it was unset.
    await expect(importEnv({ ...ALL, OPENAI_API_KEY: undefined })).rejects.toThrow(
      /OPENAI_API_KEY/,
    )
  })

  it("names every missing variable at once, not just the first", async () => {
    const failure = importEnv({})
    await expect(failure).rejects.toThrow(/ANTHROPIC_API_KEY/)
    await expect(importEnv({})).rejects.toThrow(/OPENAI_API_KEY/)
    await expect(failure).rejects.toThrow(/\.env\.local/)
  })

  it("rejects a key set to empty rather than treating it as present", async () => {
    await expect(importEnv({ ...ALL, ANTHROPIC_API_KEY: "" })).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    )
  })

  it("rejects a DATABASE_URL that is not a postgres URL", async () => {
    // The mistake this catches is copying the wrong field out of the Neon
    // console — the dashboard also shows a psql command and a plain hostname,
    // and neither of them connects.
    await expect(
      importEnv({ ...ALL, DATABASE_URL: "ep-quiet-grass.us-east-2.aws.neon.tech" }),
    ).rejects.toThrow(/DATABASE_URL/)
  })

  it("rejects an AUTH_GOOGLE_ID that is not a Google client id", async () => {
    // The Google console shows a project number, a client id and a secret on
    // one screen, and only the client id ends in this suffix. Pasting the
    // project number otherwise fails much later, as a redirect loop.
    await expect(importEnv({ ...ALL, AUTH_GOOGLE_ID: "47267730759" })).rejects.toThrow(
      /AUTH_GOOGLE_ID/,
    )
  })

  it("rejects a hand-typed AUTH_SECRET that is too short to be one", async () => {
    // The only mistake here that produces no error of its own: sessions still
    // sign, they are just cheap to forge.
    await expect(importEnv({ ...ALL, AUTH_SECRET: "secret" })).rejects.toThrow(
      /AUTH_SECRET/,
    )
  })

  it("rejects an ADMIN_EMAIL that is not an address", async () => {
    // It is compared against what Google returns; a value that cannot be an
    // email matches nobody, and the symptom is an app with no admin in it.
    await expect(importEnv({ ...ALL, ADMIN_EMAIL: "admin" })).rejects.toThrow(
      /ADMIN_EMAIL/,
    )
  })

  it("skips validation for builds, which have no secrets", async () => {
    // `next build` imports every route to collect page data. Failing CI there
    // would be failing for a reason unrelated to whether the code compiles.
    const { env } = await importEnv({ SKIP_ENV_VALIDATION: "1" })
    expect(env).toBeDefined()
  })
})
