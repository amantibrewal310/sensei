import { z } from "zod"

// The lesson is an outline of PAGES, and a page is one topic on one canvas.
//
// Everything used to share a single board, so a lesson on rate limiting had to
// fit its motivation, four algorithms and a comparison into the same twelve
// cells. Splitting it means each page is drawn on an empty canvas, and the
// outline becomes the index the learner navigates by — during the lesson and
// after it.

export const PAGE_KINDS = ["concept", "algorithm", "code", "recap"] as const
export type PageKind = (typeof PAGE_KINDS)[number]

/**
 * A topic as the learner typed it.
 *
 * The cap is cost control as much as validation: the topic is sent to the
 * planner, again with every board request, and again with every teaching turn,
 * so an essay pasted here is billed once per page for the whole lesson. It also
 * lands in a URL. Control characters are rejected because they arrive from a
 * paste gone wrong or an injection attempt, never from someone naming a subject.
 */
export const MAX_TOPIC = 200
const CONTROL = /[\p{Cc}\p{Cf}]/u

export const Topic = z
  .string()
  .max(MAX_TOPIC)
  .transform((t) => t.trim())
  .refine((t) => t.length > 0, "topic is required")
  .refine((t) => !CONTROL.test(t), "topic must not contain control characters")

export interface Page {
  id: string
  /** Outline entry — a noun phrase, not a question. "Token bucket". */
  title: string
  /** One line under the title in the outline. */
  summary: string
  /** What the teacher actually works through on this page. */
  question: string
  kind: PageKind
}

/**
 * A page coming back *in* from the browser, which is not the same thing as a
 * page coming out of the planner: this one already carries the id `parsePlan`
 * assigned. `/api/board` and `/api/teach` are handed these by the client and
 * cannot assume the client is this app.
 */
export const PageSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  summary: z.string().max(500).default(""),
  question: z.string().min(1).max(500),
  kind: z.enum(PAGE_KINDS).default("concept"),
}) satisfies z.ZodType<Page>

/**
 * Everything that varies by page kind, in one exhaustive table.
 *
 * `badge` is what the outline prints beside the title; `teachingRule` is added
 * to the teacher's prompt for that page. Both used to be their own partial
 * lookup — one in an API route, one in a component — so a fifth kind would have
 * compiled cleanly and silently done nothing in either. `Record<PageKind, …>`
 * makes forgetting one a type error.
 */
// A page about a named mechanism is not taught until the learner has seen the
// mechanism. Left as a general nudge in the system prompt, the teacher drew the
// idea and skipped the implementation on most algorithm pages.
const MUST_SHOW_CODE =
  'THIS PAGE MUST SHOW CODE. Emit exactly one "code" line for this page\'s core check — the thing the algorithm actually does per request. Say what it does in the sentence before it. It appears in a pane beside the board, so it does not compete with the diagram for room.'

export const PAGE_KIND: Record<
  PageKind,
  { badge?: string; teachingRule?: string }
> = {
  concept: {},
  recap: {},
  algorithm: { badge: "algorithm", teachingRule: MUST_SHOW_CODE },
  code: { badge: "code", teachingRule: MUST_SHOW_CODE },
}

const RawPage = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  question: z.string().min(1),
  kind: z.enum(PAGE_KINDS).default("concept"),
})

const RawPlan = z.object({ pages: z.array(RawPage).min(2).max(9) })

export const PlanJsonSchema = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          question: { type: "string" },
          kind: { type: "string", enum: PAGE_KINDS },
        },
        required: ["title", "summary", "question", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["pages"],
  additionalProperties: false,
} as const

export function parsePlan(data: unknown): Page[] {
  // Zod has already stripped anything it wasn't asked for, so the page comes
  // through whole and only wants an id. Copying field by field meant a new
  // field on `Page` was dropped here silently.
  return RawPlan.parse(data).pages.map((p, i) => ({ ...p, id: `page-${i + 1}` }))
}

export const PLAN_SYSTEM = `You design the outline of a lesson — its table of contents.

Return PAGES. Each page is one topic, taught on its own empty whiteboard, in order. A page is not a bullet point: it is a few minutes of teaching with its own diagram.

Rules:
- 4 to 8 pages. Start with why the thing exists and what it has to do, before any mechanism.
- If the topic has several named techniques, algorithms, or variants, GIVE EACH ITS OWN PAGE. A page per algorithm is the whole point — never one page listing them all.
- End with a page that compares the options and says when to reach for which.
- "kind": "concept" for motivation and requirements, "algorithm" for one named mechanism, "code" for a page whose centre of gravity is an implementation, "recap" for the closing comparison.
- "title" is a short noun phrase for the outline ("Token bucket"), "summary" is one line on what the page covers, "question" is the single question the teacher works through on that page.

For "rate limiting" a good outline is: why rate limit / what a limiter must guarantee / fixed window / sliding window log / sliding window counter / token bucket / leaky bucket / choosing one.`
