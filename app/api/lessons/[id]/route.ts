import { NextResponse } from "next/server"
import { asc, eq } from "drizzle-orm"
import { db, lessonPages, lessons } from "@/lib/db"
import { requireApproved } from "@/lib/guard"
import { StoredLesson, StoredPage } from "@/lib/replay"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * One stored lesson, everything the client needs to teach it again for free.
 *
 * Validated on the way out, not just on the way in. These rows are jsonb, so
 * the database will hand back whatever was put there — including something
 * written by an older version of the schema. A lesson that no longer parses
 * should say so here rather than fail somewhere in the renderer with a
 * coordinate missing.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApproved()
  if (!gate.ok) return gate.response

  const { id } = await ctx.params

  // The pages do not depend on how the ownership check answers, so both
  // selects run at once and the rows are simply discarded on a 404.
  const [[lesson], rows] = await Promise.all([
    db.select().from(lessons).where(eq(lessons.id, id)),
    db
      .select()
      .from(lessonPages)
      .where(eq(lessonPages.lessonId, id))
      .orderBy(asc(lessonPages.idx)),
  ])
  // Not found and not yours are the same answer on purpose: a different status
  // for the second would confirm the id exists to somebody who should not know.
  if (!lesson || (lesson.userId !== gate.user.id && gate.user.role !== "admin")) {
    return NextResponse.json({ error: "no such lesson" }, { status: 404 })
  }

  const saved = []
  for (const row of rows) {
    const parsed = StoredPage.safeParse({
      idx: row.idx,
      page: row.page,
      board: row.board,
      beats: row.beats,
    })
    // One unreadable page loses that page, not the lesson. A stored lesson is a
    // fallback, and a fallback that is all-or-nothing is not much of one.
    if (parsed.success) saved.push(parsed.data)
  }

  const answer = StoredLesson.safeParse({
    id: lesson.id,
    topic: lesson.topic,
    pages: lesson.pages,
    saved,
  })
  if (!answer.success) {
    return NextResponse.json(
      { error: "this lesson can no longer be read" },
      { status: 422 },
    )
  }

  return NextResponse.json(answer.data)
}
