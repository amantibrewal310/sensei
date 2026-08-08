import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

// drizzle-kit is a CLI, not part of the app, so Next.js has not loaded anything
// for it — .env.local has to be read explicitly here.
config({ path: ".env.local" })

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is not set. Migrations must not run through the " +
      "pooler — see docs/setup.md.",
  )
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // The unpooled URL, and this is the whole reason there are two of them. A
  // transaction-mode pooler does not hold session state across statements, so a
  // migration taking a lock loses it, and fails in ways that read as flaky
  // rather than as the wrong connection string.
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
