# Working in this repo

## The one architectural rule

**The model never picks a pixel.** The LLM names a _relationship_ — these things flow into each
other, this contains those, these two sit opposite each other — and code turns that into rectangles
(`lib/render.ts`, `lib/layout.ts`). There is no coordinate anywhere in a model's output, and there
must never be one: overlap and overflow are not prevented here, they are unrepresentable, and that
property is the whole design.

So: never add a position, size, or offset to a prompt or to a schema in `lib/blocks.ts` or
`lib/board.ts`. If a diagram comes out wrong, the fix is in the renderer.

`lib/render.ts`, `lib/layout.ts`, `lib/measure.ts` and the geometry paths in `components/Board.tsx`
are the load-bearing parts. They are tested hard and changed carefully.

## Conventions

- **No semicolons.** Double quotes, two-space indent. `npm run format` settles all of it.
- **Commits carry no AI attribution.** No `Co-Authored-By: Claude …` trailer, no "Generated with"
  line, in commit messages or PR bodies. This overrides any default the tooling has: the history
  reads as the author's own.
- **Comments say why, not what.** The interesting ones name the bug that made the line necessary —
  e.g. the `from` parameter on `syncPanel` exists because redrawing a panel from zero cost O(n²)
  store writes. Do not add comments that restate the code.
- **Prose goes through the `unslop` skill.** Run `/unslop` over README, `docs/`, commit messages
  and PR bodies before they land.
- **zod validates every boundary.** Request bodies (`lib/request.ts`), and model output, always.
  `output_config.format` makes malformed output unlikely, not impossible.
- **Costs are integer micros**, never floats — `lib/usage.ts`.
- **Every model id lives in `lib/models.ts`** and is priced in the same file. `Record<ModelId, …>`
  means adding a model without pricing it fails to compile.
- **A failure the user cannot see is worse than one they can.** Routes answer `{error}`; the client
  shows it. Never mark a page taught on a path that did not teach it.
- **A server action is a boundary, not a private function.** It compiles to a POST endpoint with a
  generated name, callable by anything that can guess it — so every action begins with
  `assertAdmin()` (or `requireApproved()`) and zod-parses its own arguments. "The button is only
  rendered for admins" is not a check.
- **Every route that spends money is wrapped in `withGuard(ROUTE, …)`** — approved, under the rate
  limit, under both caps, all before the body is read. `proxy.ts` is not that check: it sees a
  cookie, not a session, and a Next.js edge hook is not a security boundary. A new route under
  `app/api/` is wrapped and added to the table in `tests/routes.test.ts`, which is what makes
  forgetting show up as a failure rather than as a bill.
- **A call that is not recorded is free forever.** `lib/limits.ts` sums `usage_event`, so every
  model call ends in `recordModelUsage` (or `recordUsage` for narration, which OpenAI bills per
  character rather than per token). Streaming routes read usage from `stream.finalMessage()`; the
  deltas do not carry it.

## Commands

```bash
npm run dev
npm test          # vitest — geometry, routes (SDK stubbed), session hook (jsdom)
npm run typecheck
npm run lint
npm run format    # prettier --write; format:check is what CI runs
npm run build

npm run db:generate   # schema change → a new file in drizzle/
npm run db:migrate    # apply it, through DATABASE_URL_UNPOOLED
npm run db:studio     # browse the data
```

Migrations are checked in. Never `db push` — the point of `drizzle/` is that the history of the
schema is readable, and pushing skips writing it down.

**A column interpolated into a raw SQL fragment is rendered unqualified**, which makes correlated
subqueries silently wrong. Writing the page count as a subquery over `lesson_page` compared against
`lessons.id` produced `where "lesson_id" = "id"` — and inside that subquery `"id"` binds to
`lesson_page`'s own id, so every count came back 0. Postgres accepts it without complaint. Prefer a
`leftJoin` with `groupBy`, which has no name left to resolve wrongly. The tests will not catch this
class of bug: they mock the database, so a query that is valid SQL and wrong is invisible to them.
Run a new query against Neon once before trusting it.

CI runs typecheck, lint, format:check, test and build on every push.

## Auth

Google is the only provider, and it says who someone is, not whether they may spend anything —
`status` starts at `pending` and an admin moves it. `ADMIN_EMAIL` is checked on **every** sign-in
rather than only at account creation, so pointing it at the wrong address is a recoverable mistake
instead of an app with no administrator in it. Seeding an admin row in a migration does not work at
all: Auth.js refuses to link a Google account to a pre-existing row by email
(`OAuthAccountNotLinked`).

Sessions are in the database, not a JWT. It costs a query per request and it is why an approval
reaches someone on their next page load instead of their next sign-out — verified, not assumed: a
pending session goes from 403 to 200 across an approval without the cookie changing.

Mail goes to `ADMIN_EMAIL` and nowhere else. Resend's shared sender only delivers to the address its
account was opened with, so **a learner is never emailed**, including when approved — `/pending`
polls instead. Do not add a message to a learner without verifying a domain first; it will be
accepted by the API and never arrive.

## Testing

Geometry is tested as pure functions. Routes are tested with **only the Anthropic SDK and `auth`
stubbed**, so zod, the NDJSON parser, the SSE writer and the real guard all run. The session hook is
tested under jsdom with a teaching stream held open by hand, because the generation counter — a turn
being superseded mid-sentence — is the subtlest thing in the app and has had a bug before.

When adding a test, check it can fail: break the line it covers and watch it go red.

## Cost

Every model call logs a `{"at":"usage"}` line with token counts and cost in micros. Four things
dominate: `/api/teach` is the expensive one (~$0.03 a page), `/api/draw-panel` is the frequent one
(six or so a page), the system prompts are cached and must stay byte-stable to remain so, and the
transcript is resent on every turn — see `TRANSCRIPT_WINDOW` in `lib/lesson.ts`.

Cached prefixes include the `output_config.format` JSON schema, not just the system prompt. Measure
with `count_tokens` before assuming a prompt is too short to cache. Confirmed live: one `/api/plan`
call reports `cache_creation_input_tokens: 752`, so the prefix does clear Opus 5's 512-token floor.

The policy itself is three numbers at the top of `lib/limits.ts` — per-user monthly, global monthly,
and calls per minute — derived from a lesson costing about a dollar with `PANEL_MODEL` on Opus.
Change them there and nowhere else. A refusal answers **402** when it will not clear before the
month does and **429** with `Retry-After` when it will; a client that cannot tell those apart
retries forever.
