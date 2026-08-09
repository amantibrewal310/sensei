import type Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import { anthropic } from "./anthropic"
import type { ModelId } from "./models"
import { safeJson } from "./request"
import type { Frame } from "./sse"
import { foldUsage, recordModelUsage, type TokenUsage } from "./usage"

// One call to Claude, spend recorded — the skeleton every model route shares.
//
// teach and draw-panel stream; plan and board ask for one JSON document. Both
// skeletons used to be copy-pasted per route, which left the invariants
// CLAUDE.md cares most about — usage recorded even for an interrupted turn, a
// truncated turn visibly failing instead of ending cleanly — enforced by
// convention in four places. Here they are structural: the next model route
// cannot take the call without them.

/**
 * The system prompt as the cacheable prefix. Every route marks its prompt
 * ephemeral; the prompts are byte-stable, so the first call of a burst writes
 * the cache entry every later call reads.
 */
export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }]
}

/**
 * Streams a model call as SSE frames, recording the spend on every exit path.
 *
 * Usage is folded in as it streams and recorded in a finally, because
 * `finalMessage()` only exists for a turn that finished: an interrupted one
 * used to skip the recording entirely, and a call that lands no row in
 * usage_event is free as far as every cap is concerned.
 *
 * A turn that ran out of room or was declined ends *cleanly* on the wire, so
 * without the trailing error frames the client marked the page taught and
 * saved a partial beat list — the exact path "never mark a page taught on a
 * path that did not teach it" forbids.
 */
export async function* streamModel(opts: {
  route: string
  userId: string
  params: Anthropic.MessageStreamParams & { model: ModelId }
  signal: AbortSignal
  /** Frames for one text delta — raw passthrough for teach, a line parser for draw-panel. */
  onText: (delta: string) => Iterable<Frame>
  /** Frames still buffered after the last delta, yielded before the stop check. */
  flush?: () => Iterable<Frame>
  /** The error frame's message when the turn hit max_tokens. */
  truncated: string
  /** The error frame's message when the model declined. */
  declined: string
  /** The event name that tells the client the turn finished properly. */
  done: string
}): AsyncGenerator<Frame> {
  const started = Date.now()
  const stream = anthropic.messages.stream(opts.params, { signal: opts.signal })

  const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 }
  let stop: string | null = null
  try {
    for await (const ev of stream) {
      foldUsage(usage, ev)
      if (ev.type === "message_delta") stop = ev.delta.stop_reason ?? stop
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        yield* opts.onText(ev.delta.text)
      }
    }
  } finally {
    await recordModelUsage({
      route: opts.route,
      userId: opts.userId,
      model: opts.params.model,
      usage,
      ms: Date.now() - started,
    })
  }

  if (opts.flush) yield* opts.flush()

  if (stop === "max_tokens") {
    yield { event: "error", data: { message: opts.truncated } }
    return
  }
  if (stop === "refusal") {
    yield { event: "error", data: { message: opts.declined } }
    return
  }
  yield { event: opts.done, data: {} }
}

/**
 * One non-streaming call whose answer must be a JSON document.
 *
 * The refusal check runs first because a safety classifier declines on a
 * normal 200 with empty content — without it a refusal surfaces as the
 * generic "no {noun}" 502 and the learner is told the lesson is broken when
 * in fact the topic was declined.
 */
export async function modelJson(opts: {
  route: string
  userId: string
  params: Anthropic.MessageCreateParamsNonStreaming & { model: ModelId }
  /** Names the artefact in error bodies: "no plan", "invalid board". */
  noun: string
  /** The 422 body when the model declines outright. */
  declined: string
  /** Model output to response body; throws on the wrong shape. */
  parse: (json: unknown) => unknown
}): Promise<NextResponse> {
  const started = Date.now()
  const msg = await anthropic.messages.create(opts.params)
  await recordModelUsage({
    route: opts.route,
    userId: opts.userId,
    model: opts.params.model,
    usage: msg.usage,
    ms: Date.now() - started,
  })

  if (msg.stop_reason === "refusal") {
    return NextResponse.json({ error: opts.declined }, { status: 422 })
  }

  const text = msg.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") {
    return NextResponse.json({ error: `no ${opts.noun}` }, { status: 502 })
  }
  try {
    return NextResponse.json(opts.parse(safeJson(text.text)))
  } catch {
    return NextResponse.json({ error: `invalid ${opts.noun}` }, { status: 502 })
  }
}
