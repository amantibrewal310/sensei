import type Anthropic from "@anthropic-ai/sdk"
import { PRICES, type ModelId } from "./models"
import { db, usageEvents } from "@/lib/db"

// What every model call cost, and how long it took.
//
// Nothing in this app read `usage` before, which meant no claim about cost could
// be checked — including whether the `cache_control` markers in the teaching and
// panel routes were doing anything at all. (They were not: both system prompts
// sat under the 1024-token minimum cacheable prefix of the model they were being
// sent to, so no cache entry was ever written.)
//
// The shape here is the shape the `usage_events` table wants later: a route, a
// model, four token counts, and an integer cost. Money is counted in **micros**
// — millionths of a dollar — and never as a float, because a spend cap summed
// from floating-point cents drifts, and drifts in whichever direction the
// rounding happens to favour.

/** The fields we need from an Anthropic `usage` object, and nothing more. */
export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/**
 * Folds one streaming event's usage into a running total.
 *
 * The streaming routes used to read usage from `finalMessage()` after their
 * event loop — which does not exist for a turn the learner interrupted: the
 * generator is shut down at its yield point and `finalMessage` rejects, so the
 * call vanished from `usage_event` and was free as far as every cap was
 * concerned. The wire already carries what the ledger needs — `message_start`
 * has the input and cache counts, each `message_delta` the cumulative output
 * count — so folding them in as they pass means an abandoned turn still has
 * numbers to record. Exact for input; short only by whatever the model had
 * not yet streamed at the moment of the abort.
 */
export function foldUsage(into: TokenUsage, ev: Anthropic.MessageStreamEvent): void {
  if (ev.type === "message_start") {
    Object.assign(into, ev.message.usage)
  } else if (ev.type === "message_delta") {
    into.output_tokens = ev.usage.output_tokens
  }
}

/** Cache reads bill at a tenth of the input rate; writes at 1.25x (5-minute TTL). */
const CACHE_READ_RATE = 0.1
const CACHE_WRITE_RATE = 1.25

/**
 * What one call cost, in millionths of a dollar.
 *
 * The arithmetic is simpler than it looks: a token's cost in micros is exactly
 * its per-million-token dollar price. A thousand tokens at $5/MTok is $0.005,
 * which is 5,000 micros — and 1000 x 5 is 5,000. So the rate doubles as the
 * per-token micro price, and the only rounding happens once, at the end.
 *
 * `input_tokens` is the uncached remainder only. The cached portion arrives
 * separately in the two cache fields, so these four terms do not double-count.
 */
export function costMicros(model: ModelId, usage: TokenUsage): number {
  const price = PRICES[model]
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0

  return Math.round(
    usage.input_tokens * price.input +
      cacheRead * price.input * CACHE_READ_RATE +
      cacheWrite * price.input * CACHE_WRITE_RATE +
      usage.output_tokens * price.output,
  )
}

/** Micros back to a human "$0.0123", for logs where four places matter. */
export function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`
}

/** The same number for a sentence a person reads: "$5.00", not "$5.0000". */
export function formatDollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}

/**
 * One structured line per model call.
 *
 * JSON rather than prose so it stays greppable once it is one line among many,
 * and so the same object can be handed to a `usage_events` insert later without
 * being re-derived. `console` is the honest destination for now — this app has
 * no logger, and inventing one before there is a second consumer would be
 * scaffolding rather than infrastructure.
 */
export function logUsage(
  route: string,
  model: string,
  usage: TokenUsage,
  ms: number,
  micros: number,
  userId?: string,
): void {
  console.log(
    JSON.stringify({
      at: "usage",
      route,
      model,
      user: userId,
      ms,
      input: usage.input_tokens,
      output: usage.output_tokens,
      cache_read: usage.cache_read_input_tokens ?? 0,
      cache_write: usage.cache_creation_input_tokens ?? 0,
      micros,
      cost: formatMicros(micros),
    }),
  )
}

interface Recorded {
  route: string
  userId: string
  model: string
  usage: TokenUsage
  ms: number
  /** Pre-computed for models PRICES does not cover — narration, priced per character. */
  micros: number
}

/**
 * The log line, plus a row the spend cap can read.
 *
 * The row is the part that matters: `lib/limits.ts` sums this table, so a call
 * that is not recorded here is a call that is free as far as every cap is
 * concerned. That is why a failure to insert is logged loudly rather than
 * swallowed — under-counting spend is the one way this module can lie.
 *
 * It still does not throw. The model call has already happened and been paid
 * for; failing the response as well would cost the learner their page and
 * refund nobody.
 */
export async function recordUsage(row: Recorded): Promise<void> {
  logUsage(row.route, row.model, row.usage, row.ms, row.micros, row.userId)

  try {
    await db.insert(usageEvents).values({
      userId: row.userId,
      route: row.route,
      model: row.model,
      inputTokens: row.usage.input_tokens,
      outputTokens: row.usage.output_tokens,
      cacheReadTokens: row.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: row.usage.cache_creation_input_tokens ?? 0,
      costMicros: row.micros,
      ms: row.ms,
    })
  } catch (err) {
    console.log(
      JSON.stringify({
        at: "usage",
        ok: false,
        error: String(err),
        note: "spend not recorded — every cap now under-counts by this call",
      }),
    )
  }
}

/** `recordUsage` for a Claude call, which knows its own price. */
export function recordModelUsage(
  row: Omit<Recorded, "micros"> & { model: ModelId },
): Promise<void> {
  return recordUsage({ ...row, micros: costMicros(row.model, row.usage) })
}
