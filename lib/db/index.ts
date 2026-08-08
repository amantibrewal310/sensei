import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { env } from "@/lib/env"
import * as schema from "./schema"

// The HTTP driver, not the TCP one, and the difference is measurable rather
// than theoretical: a `pg` client spends ~1.8s on TCP, TLS and auth before it
// can ask anything, against ~250ms for one HTTPS request to the same database.
// A serverless function pays that handshake on every cold start, so the driver
// with no connection to establish is the one that fits. It also means there is
// no pool to exhaust and nothing to close.

/**
 * The connection string, or a stand-in during a build that has no secrets.
 *
 * `next build` imports every route module to collect page data, and CI builds
 * with SKIP_ENV_VALIDATION and no DATABASE_URL. This used to be solved with a
 * lazy Proxy that connected on first property access — which worked until
 * `DrizzleAdapter` needed to identify the client, because `is(db, PgDatabase)`
 * reads `Object.getPrototypeOf(db).constructor` and a Proxy over `{}` answers
 * `Object`. The adapter refused the database with "Unsupported database type".
 *
 * A placeholder is the smaller mechanism: the build wants an object of the
 * right shape, not a working database, and no request is served during it. The
 * host is `.invalid`, which RFC 2606 guarantees never resolves — so if this
 * ever were queried it fails by name rather than reaching something real.
 */
function connectionString(): string {
  if (env.DATABASE_URL) return env.DATABASE_URL
  if (process.env.SKIP_ENV_VALIDATION) {
    return "postgresql://build:build@db.invalid/build"
  }
  // Unreachable while lib/env.ts validates, and here so it stays that way.
  throw new Error("DATABASE_URL is not set")
}

export const db = drizzle(neon(connectionString()), { schema })

export * from "./schema"
