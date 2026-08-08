import { z } from "zod"
import { Block } from "@/lib/blocks"
import { BoardSchema } from "@/lib/board"
import { PageSchema, Topic } from "@/lib/lesson"

// What a taught lesson looks like once it is written down.
//
// Everything a lesson costs money to produce is here: the outline, each page's
// board, and the ordered beats the teacher emitted — with the blocks each draw
// beat produced folded in beside it. Stored, a lesson replays without calling
// Anthropic at all, which is the difference between a demo and a gamble on the
// room's wifi.
//
// It is not free: narration is still synthesised, because storing audio is a
// different problem. But that is the cheap, fast, gracefully-degrading half —
// the narrator already treats a failed clip as silence.

/**
 * One beat, discriminated on a `kind` this app chooses rather than on the
 * teacher's own `type`.
 *
 * The teacher emits two different shapes both called `draw` — one naming a
 * panel, one naming a connector — and a zod discriminated union needs one
 * literal per branch. Renaming them at the boundary is cheaper than a
 * hand-rolled union that a later reader has to verify by eye.
 */
export const StoredBeat = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("speak"), text: z.string().min(1).max(4000) }),
  z.object({
    kind: z.literal("code"),
    label: z.string().min(1).max(200),
    lines: z.array(z.string().max(400)).max(60),
  }),
  z.object({
    kind: z.literal("panel"),
    panel: z.string().min(1).max(120),
    /** The blocks that call produced. This is what makes replay free. */
    blocks: z.array(Block).max(40),
  }),
  z.object({ kind: z.literal("connector"), connector: z.string().min(1).max(200) }),
])
export type StoredBeat = z.infer<typeof StoredBeat>

/** A page's worth of stored lesson, as written and as read back. */
export const StoredPage = z.object({
  idx: z.number().int().min(0).max(11),
  page: PageSchema,
  board: BoardSchema,
  beats: z.array(StoredBeat).max(200),
})
export type StoredPage = z.infer<typeof StoredPage>

/**
 * Saving one page of a lesson in progress.
 *
 * `lessonId` is absent on the first page and present after that, so a lesson
 * abandoned three pages in keeps three pages. Saving per page rather than per
 * lesson is the whole reason `lesson_page` is a table instead of a column.
 */
export const SaveLessonRequest = z.object({
  lessonId: z.uuid().optional(),
  topic: Topic,
  pages: z.array(PageSchema).min(1).max(12),
  idx: z.number().int().min(0).max(11),
  board: BoardSchema,
  beats: z.array(StoredBeat).max(200),
})

/** What `GET /api/lessons/[id]` answers, and what the client replays from. */
export const StoredLesson = z.object({
  id: z.string(),
  topic: z.string(),
  pages: z.array(PageSchema).min(1).max(12),
  saved: z.array(StoredPage),
})
export type StoredLesson = z.infer<typeof StoredLesson>
