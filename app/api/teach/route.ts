import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { sseResponse } from "@/lib/sse"
import { TEACHER_MODEL } from "@/lib/models"
import { TEACHER_SYSTEM } from "@/lib/prompts"
import { BoardSchema, describeBoard } from "@/lib/board"
import { MAX_TRANSCRIPT, PAGE_KIND, PageSchema, Topic } from "@/lib/lesson"
import { readBody } from "@/lib/request"
import { withGuard } from "@/lib/guard"
import { foldUsage, recordModelUsage, type TokenUsage } from "@/lib/usage"

export const runtime = "nodejs"
// Vercel Hobby: 10s default, 60s ceiling — and the ceiling covers the whole
// stream, not just time-to-first-byte. This is the route most at risk of
// exceeding it; the `ms` column in usage_event is the early warning, and
// §2.1 of docs/plans/2026-08-09-architecture-improvement-plan.md is the plan
// for actually watching it.
export const maxDuration = 60

// Named once: withGuard puts it in the log line, recordUsage puts it in
// `usage_event.route`, and the spend cap reads that column.
const ROUTE = "teach"

const TeachRequest = z
  .object({
    topic: Topic,
    pages: z.array(PageSchema).min(1).max(12),
    currentIndex: z.number().int().min(0),
    transcript: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().min(1).max(4000),
        }),
      )
      .max(MAX_TRANSCRIPT)
      .default([]),
    board: BoardSchema,
  })
  // `pages[currentIndex]` was checked by hand before and is the one cross-field
  // invariant here — an index past the end used to reach `current.title`.
  .refine((b) => b.currentIndex < b.pages.length, {
    message: "currentIndex is past the end of pages",
    path: ["currentIndex"],
  })

export const POST = withGuard(ROUTE, async (req, user) => {
  const body = await readBody(req, TeachRequest)
  if (!body.ok) return body.response
  const { pages, currentIndex, transcript, board } = body.data

  const current = pages[currentIndex]

  // The outline is given in full so the teacher knows what it does NOT have to
  // cover here. Without it, every page drifts into the next one's material and
  // the lesson says the same thing five times.
  const outline = pages
    .map(
      (p, i) =>
        `${i + 1}. ${p.title}${i === currentIndex ? "  <- you are teaching this page" : ""} — ${p.summary}`,
    )
    .join("\n")

  const { panels, connectors } = describeBoard(board)
  const rule = PAGE_KIND[current.kind].teachingRule

  const context =
    `Lesson topic: ${body.data.topic}\n\nThe lesson's outline:\n${outline}\n\n` +
    `This page is "${current.title}" (${current.kind}). ` +
    `The question to work through: ${current.question}\n` +
    (rule ? `\n${rule}\n` : "") +
    `\nThis page's whiteboard is empty. These panel ids are the ONLY things you may draw into:\n${panels}\n` +
    (connectors ? `\nAnd these connectors:\n${connectors}\n` : "")

  const messages = [
    { role: "user" as const, content: `System context:\n${context}` },
    ...transcript.map((t) => ({ role: t.role, content: t.text })),
    {
      role: "user" as const,
      content:
        "Teach this page now. Alternate speak and draw so each sentence is followed by the one thing it describes. Cover this page's question properly and leave the rest of the outline alone. Emit exactly one NDJSON turn, ending with done. Stop after done.",
    },
  ]

  async function* gen() {
    const started = Date.now()
    const stream = anthropic.messages.stream(
      {
        model: TEACHER_MODEL,
        // Thinking and response text share this budget on this model, and
        // 4000 — sized for the text alone — left a thoughtful turn ending at
        // the cap, which on the wire looks exactly like a finished page. Same
        // headroom as /api/plan; the stop_reason check below is what makes
        // running out visible instead of silent.
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: [
          {
            type: "text",
            text: TEACHER_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages,
      },
      // The learner interrupting is routine — asking a question aborts this
      // request — and without the signal the model kept generating a turn
      // nobody would read, billed in full. /api/speak has always done this.
      { signal: req.signal },
    )

    // Usage is folded in as it streams and recorded in a finally, because
    // `finalMessage()` only exists for a turn that finished: an interrupted
    // one used to skip the recording entirely, and a call that lands no row
    // in usage_event is free as far as every cap is concerned.
    const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 }
    let stop: string | null = null
    try {
      for await (const ev of stream) {
        foldUsage(usage, ev)
        if (ev.type === "message_delta") stop = ev.delta.stop_reason ?? stop
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          yield { event: "text", data: { delta: ev.delta.text } }
        }
      }
    } finally {
      await recordModelUsage({
        route: ROUTE,
        userId: user.id,
        model: TEACHER_MODEL,
        usage,
        ms: Date.now() - started,
      })
    }

    // A turn that ran out of room or was declined ended *cleanly* on the wire,
    // so without these frames the client marked the page taught and saved a
    // partial beat list — the exact path "never mark a page taught on a path
    // that did not teach it" forbids. The client already renders error frames;
    // nothing over there had to change.
    if (stop === "max_tokens") {
      yield {
        event: "error",
        data: {
          message: "The teacher ran out of room on this page. Ask again to re-teach it.",
        },
      }
      return
    }
    if (stop === "refusal") {
      yield { event: "error", data: { message: "This page was declined." } }
      return
    }

    yield { event: "end", data: {} }
  }

  return sseResponse(gen())
})
