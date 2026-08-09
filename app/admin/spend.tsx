import { desc, eq, gte, sql } from "drizzle-orm"
import { db, usageEvents, users } from "@/lib/db"
import { GLOBAL_CAP_MICROS, USER_CAP_MICROS } from "@/lib/limits"
import { formatDollars, formatMicros } from "@/lib/usage"

// The month's ledger, read by a person instead of a cap.
//
// usage_event has been a good durable record since it existed, but its only
// readers were checkLimits and db:studio — "what did this month cost, per
// user, per route?" needed hand-written SQL. This is that question answered on
// the page the admin already visits, which is also what gives the `ms` column
// its promised consumer: a route drifting toward the 60s function ceiling now
// shows up somewhere someone looks.
//
// The join shape is deliberate. A column interpolated into a raw SQL fragment
// renders *unqualified* (see CLAUDE.md on the correlated-subquery bug), so raw
// fragments here are aggregates only, over columns that exist in exactly one
// of the joined tables; everything two-tabled goes through the query builder,
// which qualifies names. Verified against Neon once, per the repo's rule —
// the tests mock the database and would pass over broken SQL.

/** 75% of the 60s ceiling — the same number the drain's threshold alert fires at
 * (docs/setup.md §5), so the page and the pager never disagree about "slow". */
const MS_DRIFT_ALERT = 45_000

const monthStart = sql`date_trunc('month', now())`

/** Clamped for a CSS width: spend can legitimately overshoot the cap (bounded
 * burst, documented in lib/limits.ts) and a 103% bar would overflow its track. */
function pct(micros: number, cap: number): number {
  return Math.min(100, (micros / cap) * 100)
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

export async function Spend() {
  const [perUser, perRoute] = await Promise.all([
    db
      .select({
        email: users.email,
        name: users.name,
        micros: sql<string>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      })
      .from(usageEvents)
      .leftJoin(users, eq(usageEvents.userId, users.id))
      .where(gte(usageEvents.createdAt, monthStart))
      .groupBy(users.id, users.email, users.name)
      .orderBy(desc(sql`sum(${usageEvents.costMicros})`)),
    db
      .select({
        route: usageEvents.route,
        calls: sql<number>`count(*)::int`,
        micros: sql<string>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
        p95Ms: sql<number>`coalesce((percentile_cont(0.95) within group (order by ${usageEvents.ms}))::int, 0)`,
      })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, monthStart))
      .groupBy(usageEvents.route)
      .orderBy(desc(sql`sum(${usageEvents.costMicros})`)),
  ])

  // Summed from the rows rather than asked for in a third query, so the bar
  // can never disagree with the table beneath it. bigint arrives as a string
  // over the wire; a monthly total in micros is nowhere near the safe-integer
  // ceiling, so Number() is lossless — same reasoning as lib/limits.ts.
  const globalMicros = perUser.reduce((total, row) => total + Number(row.micros), 0)
  const globalPct = pct(globalMicros, GLOBAL_CAP_MICROS)

  return (
    <section className="mt-12">
      <h2 className="mb-1 text-lg font-semibold">Spend, month to date</h2>
      <p className="mb-4 text-sm text-neutral-600">
        What this month has cost so far, from the same table the caps read. The bar is
        distance to the kill switch — at {formatDollars(GLOBAL_CAP_MICROS)} every route
        answers 402 until next month.
      </p>

      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span>
          {formatDollars(globalMicros)} of {formatDollars(GLOBAL_CAP_MICROS)}
        </span>
        <span className="text-neutral-500">{globalPct.toFixed(0)}%</span>
      </div>
      <div className="mb-8 h-2 w-full rounded bg-neutral-100">
        <div
          className={`h-2 rounded ${globalPct >= 80 ? "bg-amber-500" : "bg-neutral-900"}`}
          style={{ width: `${globalPct}%` }}
        />
      </div>

      {perUser.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing spent yet this month.</p>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-neutral-500">
              Per person, against their {formatDollars(USER_CAP_MICROS)} cap
            </h3>
            <table className="w-full text-left text-sm">
              <tbody>
                {perUser.map((u, i) => (
                  <tr
                    key={u.email ?? `deleted-${i}`}
                    className="border-b border-neutral-100"
                  >
                    <td className="py-2">
                      {/* usage_event outlives its account on purpose — the
                          kill switch must not be resettable by deleting a
                          user — so a row with no one to name is expected. */}
                      {u.name ?? u.email ?? "account deleted"}
                      {u.name && u.email && (
                        <div className="text-xs text-neutral-500">{u.email}</div>
                      )}
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      {formatMicros(Number(u.micros))}
                    </td>
                    <td className="w-16 py-2 pl-3 text-right text-xs text-neutral-500">
                      {pct(Number(u.micros), USER_CAP_MICROS).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-neutral-500">
              Per route, with p95 wall-clock
            </h3>
            <table className="w-full text-left text-sm">
              <tbody>
                {perRoute.map((r) => (
                  <tr key={r.route} className="border-b border-neutral-100">
                    <td className="py-2 font-mono text-xs">{r.route}</td>
                    <td className="py-2 text-right text-xs text-neutral-500">
                      {r.calls} calls
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      {formatMicros(Number(r.micros))}
                    </td>
                    <td
                      className={`py-2 pl-3 text-right font-mono text-xs ${
                        r.p95Ms >= MS_DRIFT_ALERT
                          ? "font-semibold text-amber-600"
                          : "text-neutral-500"
                      }`}
                    >
                      {seconds(r.p95Ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-neutral-500">
              p95 turns amber at {seconds(MS_DRIFT_ALERT)} — the routes run under a 60s
              function ceiling, and a page that is killed at it fails the way a truncated
              one does.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
