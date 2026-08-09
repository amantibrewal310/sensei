import { count, desc, eq } from "drizzle-orm"
import { db, lessonPages, lessons } from "@/lib/db"

/**
 * Every lesson this person has, newest first, with its page count. One
 * function for the home page and GET /api/lessons, so the safe shape below is
 * written once.
 *
 * A join and a group-by rather than a correlated subquery, and not for taste.
 * Interpolating columns into a sql`` fragment renders them *unqualified* —
 * `where "lesson_id" = "id"` — and inside a subquery over lesson_page, `"id"`
 * binds to lesson_page's own id. Postgres accepts it and every count comes
 * back 0. This shape has no name for Postgres to resolve wrongly.
 */
export function listLessons(userId: string, limit: number) {
  return db
    .select({
      id: lessons.id,
      topic: lessons.topic,
      createdAt: lessons.createdAt,
      pages: count(lessonPages.id),
    })
    .from(lessons)
    .leftJoin(lessonPages, eq(lessonPages.lessonId, lessons.id))
    .where(eq(lessons.userId, userId))
    .groupBy(lessons.id, lessons.topic, lessons.createdAt)
    .orderBy(desc(lessons.createdAt))
    .limit(limit)
}
