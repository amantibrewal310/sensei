import { describe, expect, it, vi } from "vitest"

// `lib/env` validates at module scope, which is the point of it — so every case
// here needs a fresh module registry and a process.env set up before the
// import, not after.
const MANAGED = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "SKIP_ENV_VALIDATION",
] as const

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
  it("reads the keys when both are set", async () => {
    const { env } = await importEnv({
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: "sk-openai-test",
    })
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test")
    expect(env.OPENAI_API_KEY).toBe("sk-openai-test")
  })

  it("names the variable that is missing", async () => {
    // The whole point: the old code sent `Bearer undefined` to OpenAI and came
    // back with a 401 that mentioned neither the variable nor that it was unset.
    await expect(
      importEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }),
    ).rejects.toThrow(/OPENAI_API_KEY/)
  })

  it("names every missing variable at once, not just the first", async () => {
    const failure = importEnv({})
    await expect(failure).rejects.toThrow(/ANTHROPIC_API_KEY/)
    await expect(importEnv({})).rejects.toThrow(/OPENAI_API_KEY/)
    await expect(failure).rejects.toThrow(/\.env\.local/)
  })

  it("rejects a key set to empty rather than treating it as present", async () => {
    await expect(
      importEnv({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "sk-openai-test" }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/)
  })

  it("skips validation for builds, which have no secrets", async () => {
    // `next build` imports every route to collect page data. Failing CI there
    // would be failing for a reason unrelated to whether the code compiles.
    const { env } = await importEnv({ SKIP_ENV_VALIDATION: "1" })
    expect(env).toBeDefined()
  })
})
