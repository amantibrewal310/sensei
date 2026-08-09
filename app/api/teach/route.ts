import { z } from "zod"
import { cachedSystem, streamModel } from "@/lib/claude"
import { sseResponse } from "@/lib/sse"
import { TEACHER_MODEL } from "@/lib/models"
import { TEACHER_SYSTEM } from "@/lib/prompts"
import { BoardSchema, describeBoard } from "@/lib/board"
import { MAX_TRANSCRIPT, PAGE_KIND, PageSchema, Topic } from "@/lib/lesson"
import { readBody } from "@/lib/request"
import { withGuard } from "@/lib/guard"

export const runtime = "nodejs"
// Vercel Hobby: 10s default, 60s ceiling — and the ceiling covers the whole
// stream, not just time-to-first-byte. This is the route most at risk of
// exceeding it; the `ms` column in usage_event is the early warning, watched
// in two places: the admin page's p95 column and the drain's threshold alert
// (docs/setup.md §5), both of which flag at 45s.
export const maxDuration = 60

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

  return sseResponse(
    streamModel({
      route: ROUTE,
      userId: user.id,
      params: {
        model: TEACHER_MODEL,
        // Thinking and response text share this budget on this model, and
        // 4000 — sized for the text alone — left a thoughtful turn ending at
        // the cap, which on the wire looks exactly like a finished page. Same
        // headroom as /api/plan; streamModel's stop_reason check is what makes
        // running out visible instead of silent.
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: cachedSystem(TEACHER_SYSTEM),
        messages,
      },
      // The learner interrupting is routine — asking a question aborts this
      // request — and without the signal the model kept generating a turn
      // nobody would read, billed in full. /api/speak has always done this.
      signal: req.signal,
      onText: (delta) => [{ event: "text", data: { delta } }],
      truncated: "The teacher ran out of room on this page. Ask again to re-teach it.",
      declined: "This page was declined.",
      done: "end",
    }),
  )
})
