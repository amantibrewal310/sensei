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
- **Comments say why, not what.** The interesting ones name the bug that made the line necessary —
  e.g. the `from` parameter on `syncPanel` exists because redrawing a panel from zero cost O(n²)
  store writes. Do not add comments that restate the code.
- **zod validates every boundary.** Request bodies (`lib/request.ts`), and model output, always.
  `output_config.format` makes malformed output unlikely, not impossible.
- **Costs are integer micros**, never floats — `lib/usage.ts`.
- **Every model id lives in `lib/models.ts`** and is priced in the same file. `Record<ModelId, …>`
  means adding a model without pricing it fails to compile.
- **A failure the user cannot see is worse than one they can.** Routes answer `{error}`; the client
  shows it. Never mark a page taught on a path that did not teach it.
- **Every route that spends money calls `requireApproved()` first**, before it reads the body.
  `proxy.ts` is not that check — it sees a cookie, not a session, and a Next.js edge hook is not a
  security boundary. A new route under `app/api/` is guarded and added to the table in
  `tests/routes.test.ts`, which is what makes forgetting show up as a failure rather than as a bill.

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

CI runs typecheck, lint, format:check, test and build on every push.

## Auth

Google is the only provider, and it says who someone is, not whether they may spend anything —
`status` starts at `pending` and an admin moves it. `ADMIN_EMAIL` is checked on **every** sign-in
rather than only at account creation, so pointing it at the wrong address is a recoverable mistake
instead of an app with no administrator in it. Seeding an admin row in a migration does not work at
all: Auth.js refuses to link a Google account to a pre-existing row by email
(`OAuthAccountNotLinked`).

Sessions are in the database, not a JWT. It costs a query per request and it is why an approval
reaches someone on their next page load instead of their next sign-out.

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
with `count_tokens` before assuming a prompt is too short to cache.
