import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"
import type { AdapterAccountType } from "next-auth/adapters"

// Two naming conventions live in this file, on purpose.
//
// The four tables below the line are Auth.js's, and their names and columns are
// its contract — singular table names, camelCase columns, quoted in SQL because
// of it. Renaming them means hand-mapping every column when the adapter is
// wired up, in exchange for tidiness nobody sees.
//
// Everything this app owns — the columns added to `user`, and `usage_event` —
// is snake_case, which is what Postgres does when you do not fight it.

export const userStatus = pgEnum("user_status", ["pending", "approved", "rejected"])
export const userRole = pgEnum("user_role", ["user", "admin"])

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  /**
   * Unique, which Auth.js's documented schema does not ask for.
   *
   * It matters here because email is what identifies a person to this app —
   * it is how the admin is recognised and how you find who is waiting. With
   * one provider a duplicate cannot legitimately arise, so the constraint
   * costs nothing and turns a silent second account into a failed insert.
   */
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),

  // --- this app's, not the adapter's ---

  /**
   * Signing in is not being let in.
   *
   * Google says who someone is; it has no opinion on whether they may spend
   * this project's API budget. `pending` is the default because the safe state
   * has to be the one you get by doing nothing — a new row that arrives
   * approved is a bug that only shows up on the bill.
   */
  status: userStatus("status").notNull().default("pending"),
  role: userRole("role").notNull().default("user"),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  /**
   * Who approved them. Self-referencing, and deliberately not cascading: if the
   * admin row is ever deleted, the approvals it granted stay, pointing at
   * nobody. Losing the record of who approved someone is worse than a dangling
   * name.
   */
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
})

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
)

/**
 * Sessions in the database rather than only in a cookie.
 *
 * It costs a query per request, and it buys the thing this app's whole gate
 * depends on: approving someone takes effect on their next page load. With a
 * JWT the status is stamped into the token, so a learner sitting on `/pending`
 * would stay there until they signed out and back in — while being told they
 * had been approved.
 */
export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
})

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

/**
 * A lesson that has been taught, kept so it can be taught again for free.
 *
 * The expensive, slow, failure-prone part of this app is the Anthropic calls —
 * about a dollar and several minutes per lesson, over whatever wifi the room
 * happens to have. Everything they produce is data: an outline, a board per
 * page, and an ordered list of beats. Stored, a lesson replays with **zero**
 * calls to Anthropic, which is the difference between a demo and a gamble.
 */
export const lessons = pgTable(
  "lesson",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /**
     * `set null`, matching usage_event and for a related reason: a lesson is
     * worth keeping after the account that generated it is gone. It cost real
     * money to make and it is the thing being demonstrated.
     */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    topic: text("topic").notNull(),
    /**
     * The whole outline, including pages that were never reached.
     *
     * Not derivable from `lesson_page`: a lesson abandoned at page three of
     * eight has three rows there, and rebuilding the outline from them would
     * quietly shorten the lesson to whatever was finished.
     */
    pages: jsonb("pages").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lesson_user_created_idx").on(t.userId, t.createdAt)],
)

/**
 * One page of a stored lesson, written when that page finishes teaching.
 *
 * Per page rather than one document per lesson, because a lesson is saved as it
 * is taught: a learner who stops after three pages should keep three pages, and
 * incremental progress into a single JSON blob is a read-modify-write that
 * would lose one of them the first time two pages landed together.
 *
 * `beats` is the ordered NDJSON the teacher emitted, with the blocks that each
 * draw beat produced folded in beside it — so replay needs neither /api/teach
 * nor /api/draw-panel. Their shapes are zod'd on the way in and on the way out;
 * jsonb here is storage, not a licence to skip validation.
 */
export const lessonPages = pgTable(
  "lesson_page",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    lessonId: text("lesson_id")
      .notNull()
      // A page without its lesson is unreachable, so here cascade is right.
      .references(() => lessons.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    page: jsonb("page").notNull(),
    board: jsonb("board").notNull(),
    beats: jsonb("beats").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Re-teaching a page overwrites it rather than stacking a second copy, and
    // this is what makes that an upsert instead of a delete-then-insert.
    unique("lesson_page_lesson_idx_key").on(t.lessonId, t.idx),
  ],
)

/**
 * One row per model call, written after the call returns.
 *
 * This is `lib/usage.ts`'s log line given somewhere to live, and it is what
 * both caps read: a per-user month-to-date total, and a global ceiling that
 * trips whoever is calling.
 */
export const usageEvents = pgTable(
  "usage_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /**
     * Nullable, and `set null` rather than `cascade`, which is the opposite of
     * what the other tables do here.
     *
     * The global ceiling is a kill switch, and a kill switch that can be reset
     * by deleting a user is not one. Spend that has happened has happened; the
     * row outlives the account that caused it.
     */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    route: text("route").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    /**
     * Millionths of a dollar, as an integer. Money in a float is money that
     * disagrees with itself once you sum enough of it, and a spend cap is
     * nothing but a sum.
     */
    costMicros: bigint("cost_micros", { mode: "number" }).notNull(),
    /** Wall-clock for the call. Free to record, and the only warning you get
     * that a route is drifting towards the 60s function ceiling. */
    ms: integer("ms"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The per-user cap: "what has this person spent since the 1st".
    index("usage_event_user_created_idx").on(t.userId, t.createdAt),
    // The global ceiling asks the same question with the user left out, and a
    // leading-column index cannot answer that — hence the second one. Without
    // it the kill switch degrades to a full scan of the table it is protecting.
    index("usage_event_created_idx").on(t.createdAt),
  ],
)
