import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { sseResponse } from "@/lib/sse"
import { LineParser } from "@/lib/ndjson"
import { PANEL_MODEL } from "@/lib/models"
import { PANEL_SYSTEM } from "@/lib/prompts"
import { Block, describeBlocks, dropRedundantLabel, parseBlock } from "@/lib/blocks"
import { readBody } from "@/lib/request"
import { withGuard } from "@/lib/guard"
import { foldUsage, recordModelUsage, type TokenUsage } from "@/lib/usage"

export const runtime = "nodejs"
// Vercel Hobby: 10s default, 60s ceiling. See app/api/plan/route.ts.
export const maxDuration = 60

// Named once: withGuard puts it in the log line, recordUsage puts it in
// `usage_event.route`, and the spend cap reads that column.
const ROUTE = "draw-panel"

const DrawPanelRequest = z.object({
  title: z.string().min(1).max(200),
  note: z.string().max(500).default(""),
  what: z.string().min(1).max(1000),
  /**
   * The blocks this panel already holds, so the model adds rather than repeats.
   *
   * Previously accepted on the strength of `Array.isArray()` alone and passed
   * straight to `describeBlocks`, which JSON-stringifies each element into the
   * prompt — so anything at all could be put in front of the model here.
   */
  existing: z.array(Block).max(40).default([]),
})

// Streams BLOCKS, not shapes.
//
// The old version of this route handed the model a list of occupied rectangles
// and the first clear y below them, and asked it to place shapes in what was
// left. That is spatial arithmetic, and the model was bad at it in the specific
// way LLMs are bad at it — so a collision packer sat downstream repairing the
// answer, and the repairs were what you saw on the board. There is nothing to
// repair now: a block cannot express a position, so it cannot express a bad one.
export const POST = withGuard(ROUTE, async (req, user) => {
  const body = await readBody(req, DrawPanelRequest)
  if (!body.ok) return body.response
  // Parsing rather than hand-checking also retires the `panelTitle` const that
  // used to live here: `title` was `string | undefined` narrowed by a guard, and
  // the hoisted `gen` below could not see the narrowing. It arrives as a string.
  const { title, note, what, existing } = body.data

  const alreadyThere = existing.length
    ? `This panel already holds these blocks, in order. Add BELOW them, and do not repeat them:\n${describeBlocks(existing)}`
    : "This panel is empty."

  const userText =
    `Panel: "${title}"${note ? ` — ${note}` : ""}\n\n` +
    `${alreadyThere}\n\nAdd now:\n${what}`

  async function* gen() {
    const started = Date.now()
    const stream = anthropic.messages.stream(
      {
        model: PANEL_MODEL,
        max_tokens: 2000,
        // On this model, leaving `thinking` unset runs adaptive thinking — so
        // the app's most frequent call was deliberating over a task that is
        // one or two JSON lines, spending tokens from the same 2000 the
        // blocks come out of. Low effort keeps thinking legal and minimal.
        // The prefix cache is unaffected: effort is not part of the prompt.
        output_config: { effort: "low" },
        system: [
          {
            type: "text",
            text: PANEL_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userText }],
      },
      // Abandoned whenever the learner moves on mid-drawing; see /api/teach.
      { signal: req.signal },
    )

    // Normalised here, at the producer, rather than by whoever happens to be
    // reading the stream — the rule ("a stack heading must not repeat the frame
    // label it sits under") is a fact about this prompt, and `title` is right
    // here. A second consumer, or a replay of stored blocks, gets it too.
    const parser = new LineParser((line: string) => {
      const block = parseBlock(line)
      return block && dropRedundantLabel(block, title)
    })

    // Folded in as it streams and recorded in a finally, so a drawing the
    // learner abandoned mid-beat still lands in usage_event — see /api/teach.
    // Highest-volume call in the app, so this is also the line that says
    // whether the panel prompt's cache is live.
    const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 }
    let stop: string | null = null
    try {
      for await (const ev of stream) {
        foldUsage(usage, ev)
        if (ev.type === "message_delta") stop = ev.delta.stop_reason ?? stop
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          for (const block of parser.push(ev.delta.text)) {
            yield { event: "block", data: block }
          }
        }
      }
    } finally {
      await recordModelUsage({
        route: ROUTE,
        userId: user.id,
        model: PANEL_MODEL,
        usage,
        ms: Date.now() - started,
      })
    }
    for (const block of parser.flush()) yield { event: "block", data: block }

    // A truncated or declined stream ends cleanly on the wire, and the line
    // parser drops a trailing partial line by design — so running out of
    // room used to be indistinguishable from the model simply drawing less.
    if (stop === "max_tokens") {
      yield {
        event: "error",
        data: { message: `Couldn't finish drawing into “${title}”.` },
      }
      return
    }
    if (stop === "refusal") {
      yield { event: "error", data: { message: "The drawing was declined." } }
      return
    }

    yield { event: "done", data: {} }
  }

  return sseResponse(gen())
})
