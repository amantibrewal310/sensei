import { z } from "zod"
import { cachedSystem, streamModel } from "@/lib/claude"
import { sseResponse } from "@/lib/sse"
import { LineParser } from "@/lib/ndjson"
import { PANEL_MODEL } from "@/lib/models"
import { PANEL_SYSTEM } from "@/lib/prompts"
import { Block, describeBlocks, dropRedundantLabel, parseBlock } from "@/lib/blocks"
import { readBody } from "@/lib/request"
import { withGuard } from "@/lib/guard"

export const runtime = "nodejs"
// Vercel Hobby: 10s default, 60s ceiling. See app/api/plan/route.ts.
export const maxDuration = 60

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

  // Normalised here, at the producer, rather than by whoever happens to be
  // reading the stream — the rule ("a stack heading must not repeat the frame
  // label it sits under") is a fact about this prompt, and `title` is right
  // here. A second consumer, or a replay of stored blocks, gets it too.
  const parser = new LineParser((line: string) => {
    const block = parseBlock(line)
    return block && dropRedundantLabel(block, title)
  })
  const frame = (block: Block) => ({ event: "block", data: block })

  return sseResponse(
    streamModel({
      route: ROUTE,
      userId: user.id,
      params: {
        model: PANEL_MODEL,
        max_tokens: 2000,
        // On this model, leaving `thinking` unset runs adaptive thinking — so
        // the app's most frequent call was deliberating over a task that is
        // one or two JSON lines, spending tokens from the same 2000 the
        // blocks come out of. Low effort keeps thinking legal and minimal.
        // The prefix cache is unaffected: effort is not part of the prompt.
        output_config: { effort: "low" },
        system: cachedSystem(PANEL_SYSTEM),
        messages: [{ role: "user", content: userText }],
      },
      // Abandoned whenever the learner moves on mid-drawing; see /api/teach.
      signal: req.signal,
      onText: (delta) => parser.push(delta).map(frame),
      flush: () => parser.flush().map(frame),
      // The line parser drops a trailing partial line by design, so truncation
      // used to be indistinguishable from the model simply drawing less.
      truncated: `Couldn't finish drawing into “${title}”.`,
      declined: "The drawing was declined.",
      done: "done",
    }),
  )
})
