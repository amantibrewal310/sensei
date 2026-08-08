import { PRICES, type ModelId } from "./models"

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

/** Micros back to a human "$0.0123", for logs and eventually for the admin page. */
export function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`
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
  model: ModelId,
  usage: TokenUsage,
  ms: number,
): void {
  const micros = costMicros(model, usage)
  console.log(
    JSON.stringify({
      at: "usage",
      route,
      model,
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
