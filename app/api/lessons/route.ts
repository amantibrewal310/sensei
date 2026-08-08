import { NextResponse } from "next/server"
import { count, desc, eq, sql } from "drizzle-orm"
import { db, lessonPages, lessons } from "@/lib/db"
import { requireApproved } from "@/lib/guard"
import { readBody } from "@/lib/request"
import { SaveLessonRequest } from "@/lib/replay"

export const runtime = "nodejs"
export const maxDuration = 60

// `requireApproved`, deliberately not `withGuard`.
//
// withGuard also enforces the spend caps, and these two routes spend nothing —
// they read and write rows. Putting a budget check in front of a stored lesson
// would mean the replay stops working at exactly the moment the live path
// already has, which is the opposite of why any of this was persisted. A demo
// that survives a blown budget is most of the point.

/** Every lesson this person has, newest first, for the home page. */
export async function GET() {
  const gate = await requireApproved()
  if (!gate.ok) return gate.response

  // A join and a group-by rather than a correlated subquery, and not for taste.
  // Interpolating columns into a sql`` fragment renders them *unqualified* —
  // `where "lesson_id" = "id"` — and inside a subquery over lesson_page,
  // `"id"` binds to lesson_page's own id. Postgres accepts it and every count
  // comes back 0. This shape has no name for Postgres to resolve wrongly.
  const rows = await db
    .select({
      id: lessons.id,
      topic: lessons.topic,
      createdAt: lessons.createdAt,
      pages: count(lessonPages.id),
    })
    .from(lessons)
    .leftJoin(lessonPages, eq(lessonPages.lessonId, lessons.id))
    .where(eq(lessons.userId, gate.user.id))
    .groupBy(lessons.id, lessons.topic, lessons.createdAt)
    .orderBy(desc(lessons.createdAt))
    .limit(50)

  return NextResponse.json({ lessons: rows })
}

/**
 * Saves one page of a lesson, creating the lesson on the first call.
 *
 * Called as each page finishes rather than at the end, so a lesson stopped
 * halfway keeps the half that was taught — which is also the half that was paid
 * for.
 */
export async function POST(req: Request) {
  const gate = await requireApproved()
  if (!gate.ok) return gate.response

  const body = await readBody(req, SaveLessonRequest)
  if (!body.ok) return body.response
  const { lessonId, topic, pages, idx, board, beats } = body.data

  let id = lessonId
  if (id) {
    // Ownership is checked by making it part of the lookup rather than by
    // fetching and comparing: an id belonging to somebody else simply matches
    // nothing, and there is no branch where the comparison can be forgotten.
    const [own] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(sql`${lessons.id} = ${id} and ${lessons.userId} = ${gate.user.id}`)
    if (!own) return NextResponse.json({ error: "no such lesson" }, { status: 404 })

    // The outline can grow as the lesson is taught, so keep the longest version.
    await db.update(lessons).set({ pages }).where(eq(lessons.id, id))
  } else {
    const [created] = await db
      .insert(lessons)
      .values({ userId: gate.user.id, topic, pages })
      .returning({ id: lessons.id })
    id = created.id
  }

  // Re-teaching a page after a question replaces it rather than stacking a
  // second copy — the same rule the code pane follows for snippets.
  await db
    .insert(lessonPages)
    .values({ lessonId: id, idx, page: pages[idx], board, beats })
    .onConflictDoUpdate({
      target: [lessonPages.lessonId, lessonPages.idx],
      set: { page: pages[idx], board, beats },
    })

  return NextResponse.json({ lessonId: id })
}
