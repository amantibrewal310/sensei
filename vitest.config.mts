import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // The routes reach `lib/anthropic`, which validates the environment at
    // module scope. Fake keys rather than SKIP_ENV_VALIDATION, so the tests go
    // through the same path production does; the SDK itself is mocked, so
    // nothing is ever sent anywhere. `tests/env.test.ts` sets its own.
    env: {
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: "sk-openai-test",
      DATABASE_URL: "postgresql://u:p@host.neon.tech/neondb?sslmode=require",
      AUTH_SECRET: "test-secret-long-enough-to-satisfy-the-32-char-minimum",
      AUTH_GOOGLE_ID: "test.apps.googleusercontent.com",
      AUTH_GOOGLE_SECRET: "test-google-secret",
      ADMIN_EMAIL: "admin@example.com",
    },
  },
  resolve: {
    alias: { "@": new URL(".", import.meta.url).pathname },
  },
})
