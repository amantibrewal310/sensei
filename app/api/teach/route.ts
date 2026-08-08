import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { sseResponse } from "@/lib/sse"
import { TEACHER_MODEL } from "@/lib/models"
import { TEACHER_SYSTEM } from "@/lib/prompts"
import { BoardSchema, describeBoard } from "@/lib/board"
import { MAX_TRANSCRIPT, PAGE_KIND, PageSchema, Topic } from "@/lib/lesson"
import { readBody } from "@/lib/request"
import { withGuard } from "@/lib/guard"
import { recordModelUsage } from "@/lib/usage"

export const runtime = "nodejs"
// Vercel Hobby: 10s default, 60s ceiling — and the ceiling covers the whole
// stream, not just time-to-first-byte. This is the route most at risk of
// exceeding it; see the timing note in docs/plans/2026-08-08-production-readiness.md.
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
    const stream = anthropic.messages.stream({
      model: TEACHER_MODEL,
      max_tokens: 4000,
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
    })
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        yield { event: "text", data: { delta: ev.delta.text } }
      }
    }

    // The loop above only ever looked at text deltas, so `message_start` and
    // `message_delta` — the two events that carry usage and the cache counters —
    // went past unread. The SDK accumulates them regardless, so asking for the
    // final message after iterating costs nothing and is the only way to see
    // whether the cache_control marker above is doing anything.
    await recordModelUsage({
      route: ROUTE,
      userId: user.id,
      model: TEACHER_MODEL,
      usage: (await stream.finalMessage()).usage,
      ms: Date.now() - started,
    })

    yield { event: "end", data: {} }
  }

  return sseResponse(gen())
})
