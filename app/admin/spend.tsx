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
    <section className="mt-14">
      <h2 className="font-serif text-xl font-medium tracking-tight">
        Spend, month to date
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted text-pretty">
        What this month has cost so far, from the same table the caps read. The bar is
        distance to the kill switch — at {formatDollars(GLOBAL_CAP_MICROS)} every route
        answers 402 until next month.
      </p>

      <div className="card mt-4 px-5 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-serif text-2xl tabular-nums">
            {formatDollars(globalMicros)}
          </span>
          <span className="text-sm text-faint tabular-nums">
            {globalPct.toFixed(0)}% of {formatDollars(GLOBAL_CAP_MICROS)}
          </span>
        </div>
        <Meter
          pct={globalPct}
          className="mt-3 h-2"
          label={`${globalPct.toFixed(0)} percent of the monthly cap spent`}
        />
      </div>

      {perUser.length === 0 ? (
        <p className="mt-4 text-sm text-faint">Nothing spent yet this month.</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <h3 className="eyebrow">
              Per person, against their {formatDollars(USER_CAP_MICROS)} cap
            </h3>
            <ul className="mt-3 space-y-3">
              {perUser.map((u, i) => {
                const share = pct(Number(u.micros), USER_CAP_MICROS)
                return (
                  <li key={u.email ?? `deleted-${i}`}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      {/* usage_event outlives its account on purpose — the
                          kill switch must not be resettable by deleting a
                          user — so a row with no one to name is expected. */}
                      <span className="truncate">
                        {u.name ?? u.email ?? "account deleted"}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums">
                        {formatMicros(Number(u.micros))}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Meter
                        pct={share}
                        className="h-1 flex-1"
                        label={`${u.email ?? "this account"} has spent ${share.toFixed(0)} percent of its cap`}
                      />
                      <span className="w-9 shrink-0 text-right text-[11px] text-faint tabular-nums">
                        {share.toFixed(0)}%
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="card p-5">
            <h3 className="eyebrow">Per route, with p95 wall-clock</h3>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Route</th>
                  <th>Calls</th>
                  <th>Cost</th>
                  <th>p95</th>
                </tr>
              </thead>
              <tbody>
                {perRoute.map((r) => (
                  <tr key={r.route} className="border-b border-line last:border-b-0">
                    <td className="py-2 font-mono text-xs">{r.route}</td>
                    <td className="py-2 text-right text-xs text-faint tabular-nums">
                      {r.calls} calls
                    </td>
                    <td className="py-2 pl-3 text-right font-mono text-xs tabular-nums">
                      {formatMicros(Number(r.micros))}
                    </td>
                    <td
                      className={`py-2 pl-3 text-right font-mono text-xs tabular-nums ${
                        r.p95Ms >= MS_DRIFT_ALERT
                          ? "font-semibold text-warn"
                          : "text-faint"
                      }`}
                    >
                      {seconds(r.p95Ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs leading-relaxed text-faint">
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

/**
 * A cap, drawn. Amber past `WARN_AT` because the number alone does not read as
 * "close" — and stating that threshold twice is how the two bars start
 * disagreeing about what close means.
 */
const WARN_AT = 80

function Meter({
  pct,
  className,
  label,
}: {
  pct: number
  className: string
  label: string
}) {
  return (
    <div className={`meter ${className}`} role="img" aria-label={label}>
      <div
        className={`meter-fill ${pct >= WARN_AT ? "meter-fill-warn" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
