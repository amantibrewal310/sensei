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

type Db = ReturnType<typeof connect>

function connect() {
  return drizzle(neon(env.DATABASE_URL), { schema })
}

let instance: Db | undefined

/**
 * The database, connected on first use rather than on import.
 *
 * `next build` imports every route module to collect page data, and CI builds
 * with SKIP_ENV_VALIDATION and no secrets — so `neon(undefined)` at module
 * scope would fail the build of code that is perfectly correct. Deferring to
 * first property access means the connection string is only demanded by a
 * request that actually needs the database.
 *
 * The bind is load-bearing: drizzle's methods reach for private fields on their
 * own instance, and handing them back unbound would call them on this proxy.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    instance ??= connect()
    const value = Reflect.get(instance, prop, instance)
    return typeof value === "function" ? value.bind(instance) : value
  },
})

export * from "./schema"
