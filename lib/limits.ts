import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { formatDollars } from "@/lib/usage"

// What an approved account is allowed to spend, and how fast.
//
// Approving someone is the gate; this is the bound. Without it "approved" means
// unlimited, and the only thing between a runaway client loop and a four-figure
// bill is that nobody has written one yet.
//
// The numbers below are the whole policy. Change them here.

/**
 * A lesson costs roughly a dollar, measured rather than guessed: ~36
 * `/api/draw-panel` calls and ~6 `/api/board` calls, all on Opus, plus six
 * `/api/teach` pages at about $0.03 each. That is the figure these caps are
 * derived from — if `PANEL_MODEL` ever moves to Sonnet, a lesson gets markedly
 * cheaper and these become more generous than they read.
 */
const LESSON_DOLLARS = 1

/** Per person, per calendar month. About five lessons. */
export const USER_CAP_MICROS = 5 * LESSON_DOLLARS * 1_000_000

/**
 * Everyone together, per calendar month. The actual kill switch.
 *
 * This is the number that decides what a bad day costs, so it is the one worth
 * being deliberate about. It trips regardless of who is calling, which is the
 * point: the per-user cap assumes the problem is one account, and the failure
 * this exists for is the one where that assumption is wrong.
 */
export const GLOBAL_CAP_MICROS = 25 * LESSON_DOLLARS * 1_000_000

/**
 * Calls per person per minute.
 *
 * A single lesson page fires about fifteen — one board, one teach, six panels,
 * seven sentences of narration — spread across a minute or so of narration. So
 * ordinary use runs at roughly a sixth of this. That gap is deliberate: a limit
 * that trips during normal use is a bug, not a limit. It is here to stop a
 * client stuck in a loop, not to ration anybody.
 */
export const RATE_LIMIT = 120
const RATE_WINDOW_SECONDS = 60

export type Denial = { reason: string; retryable: boolean }

/**
 * All three checks in one round trip.
 *
 * One query rather than three because this runs before *every* model call, and
 * three sequential round trips to Neon would be three times the latency for an
 * answer that is almost always "fine". `filter` lets one scan of one index
 * answer all of it.
 *
 * The counts come from `usage_event`, which is written *after* a call returns —
 * so a burst of genuinely simultaneous requests can each see a total that does
 * not yet include the others. The overshoot is bounded by how much can be
 * in flight at once, which for this app is one lesson. That is an acceptable
 * error for a cost backstop and would not be for a DoS defence; this is the
 * former.
 *
 * The outer WHERE is what keeps this scan bounded. The month and rate-window
 * predicates in the FILTER clauses cannot limit what is read — they only
 * decide what is counted — so without it every model call scanned the table's
 * entire history, growing forever. `least(...)` rather than the month alone
 * because for the first sixty seconds of a month the rate window reaches into
 * the previous one, and a WHERE that cut it off would briefly under-count
 * `recent` at exactly the boundary. Verified against Neon: the bounded and
 * unbounded forms return identical totals, and the predicate lands on the
 * scan itself — a seq scan while the table is tiny (correctly; the planner
 * switches to usage_event_created_idx as it grows), where the FILTER-only
 * form gave the planner nothing to bound the scan with at any size.
 */
export async function checkLimits(userId: string): Promise<Denial | null> {
  const rows = await db.execute<{
    user_micros: string
    global_micros: string
    recent: number
  }>(sql`
    select
      coalesce(sum(cost_micros) filter (
        where user_id = ${userId} and created_at >= date_trunc('month', now())
      ), 0)::bigint as user_micros,
      coalesce(sum(cost_micros) filter (
        where created_at >= date_trunc('month', now())
      ), 0)::bigint as global_micros,
      count(*) filter (
        where user_id = ${userId}
          and created_at > now() - ${`${RATE_WINDOW_SECONDS} seconds`}::interval
      )::int as recent
    from usage_event
    where created_at >= least(
      date_trunc('month', now()),
      now() - ${`${RATE_WINDOW_SECONDS} seconds`}::interval
    )
  `)

  const row = rows.rows[0]
  if (!row) return null

  // bigint arrives as a string over the wire. The comparisons below would
  // coerce it anyway — a string against a number is compared numerically — so
  // this is not what makes them correct. It is here so that the first person to
  // write arithmetic on these totals does not get "9" + "1" === "91". A monthly
  // total in micros is nowhere near the safe-integer ceiling, so it is lossless.
  const userMicros = Number(row.user_micros)
  const globalMicros = Number(row.global_micros)

  // The permanent refusals are checked before the temporary one, and the order
  // is the whole point. Both can be true at once, and answering "too many
  // requests, try again in a minute" to somebody whose month is over sends a
  // well-behaved client into backing off and retrying forever against a wall
  // that will not move until the calendar does. The refusal that does not clear
  // is the more truthful thing to say.
  if (globalMicros >= GLOBAL_CAP_MICROS) {
    // Deliberately does not say whose spending it was. The person reading this
    // is usually not the person who caused it, and it is not their business.
    return {
      reason: "sensei has reached its monthly API budget and is paused until next month.",
      retryable: false,
    }
  }

  if (userMicros >= USER_CAP_MICROS) {
    return {
      reason: `You have used your ${formatDollars(USER_CAP_MICROS)} of API budget for this month.`,
      retryable: false,
    }
  }

  if (row.recent >= RATE_LIMIT) {
    return {
      reason: "Too many requests. Wait a moment and try again.",
      retryable: true,
    }
  }

  return null
}
