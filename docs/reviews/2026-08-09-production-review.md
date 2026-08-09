# sensei — Production Readiness Review

**Date:** 2026-08-09
**Scope:** Full codebase — every file under `lib/`, `app/`, `hooks/`, `components/`, `tests/`, the schema, CI, and the docs. Cost and caching claims were verified against current Anthropic API documentation (Opus 5 pricing, cache rates and TTLs, minimum cacheable prefix — all of the repo's numbers check out).
**Reviewer stance:** what would need to be true for this app to run for strangers, unattended, without surprising anyone with a bill or a silent failure.

---

## Verdict, in three sentences

This is an unusually well-engineered codebase for its size — the semantic/geometry split is genuinely novel LLM product architecture, the cost governance is more disciplined than most production systems, and the comments record _why_ at a level that makes the codebase self-auditing. The gaps are the classic solo-project ones: observability stops at `console.log`, durability depends on the browser tab surviving, and there is one real hole in the cost ledger (interrupted streams are billed but never recorded). Nothing here is architecturally wrong; the improvement plan is about hardening what exists, not replacing it.

---

## Part 1 — What is done well

### 1.1 The semantic/geometry split is the right answer to the hardest problem

"The model never picks a pixel" is not a slogan here — it is structurally enforced. The block vocabulary (`lib/blocks.ts`) has no coordinate field, so a model cannot express an overlap; `lib/render.ts` is the only code that chooses a coordinate, and it is pure and deterministic. Overlap and overflow are **unrepresentable, not prevented** — there is no collision packer because there is nothing to repair. Most teams building LLM-drawn diagrams fight coordinate hallucination with retry loops and repair passes; this design deletes the failure class. The measurement layer (`lib/measure.ts`) is checked against tldraw's actual font constants rather than eyeballed, with the reasoning documented ("being four pixels short is the difference between 'low memory' and 'low / memor / y'").

### 1.2 Cost governance is a first-class subsystem, not an afterthought

- Money is **integer micros everywhere** (`lib/usage.ts`), never floats — a spend cap is a sum, and float sums drift.
- Every model id lives in `lib/models.ts` priced via `Record<ModelId, …>`, so adding a model without pricing it **fails to compile**.
- The second vendor is not forgotten: TTS is estimated per character (`TTS_MICROS_PER_CHAR`), deliberately rounded generously, and labelled an estimate. A cap that silently ignores one of two vendors is not a cap.
- The whole policy is three numbers at the top of `lib/limits.ts`, derived from a _measured_ lesson cost, not a guess.
- Refusals distinguish **402 (will not clear before the month does) from 429 with `Retry-After` (will clear)** — the difference between a client that backs off and one that retries forever. This distinction is tested.
- All three limit checks run in **one SQL round trip** via `FILTER` clauses.

### 1.3 Security posture at every boundary

- Every spending route is wrapped in `withGuard` (session → limits → body, cheapest first), and `tests/routes.test.ts` encodes the five routes as a **table**, so a new route landing unguarded shows up as a missing test row rather than a bill.
- Server actions are treated as what they compile to — POST endpoints with guessable names. `decide()` in `app/admin/actions.ts` runs `assertAdmin()` and zod-parses its own arguments; "the button is only rendered for admins" is explicitly not a check. It also refuses self-demotion, which is the one move that would lock the app with no admin.
- zod validates **every direction**: request bodies (`lib/request.ts`), model output (even under `output_config.format`, which makes malformed output unlikely, not impossible), and jsonb **on the way out of the database** (`app/api/lessons/[id]/route.ts`) — rows written by an older schema fail loudly at the API instead of deep in the renderer.
- IDOR is prevented structurally: lesson ownership is part of the SQL lookup, not a fetch-then-compare, so there is no branch where the comparison can be forgotten. Not-found and not-yours are the same 404, avoiding an existence oracle.
- `safeNext()` (`lib/redirect.ts`) handles the open-redirect cases people actually miss (`//evil.example`, `/\evil.example`).
- `proxy.ts` is correctly **not** treated as a security boundary — it is a UX redirect, and the comment says exactly why.

### 1.4 Streaming failure discipline

The principle "a failure the user cannot see is worse than one they can" is applied consistently:

- `sseResponse` converts a mid-stream throw into an `error` frame; the client reads it and says so (`hooks/useTeachingSession.ts`). Before this existed a half-taught page failed in silence — and there is a test for the frame.
- One unparseable NDJSON line costs one block, not the drawing (`lib/ndjson.ts`), and the test streams input split mid-line, because "a parser that only works when each line arrives whole fails in production."
- A model refusal (`stop_reason: "refusal"`) is distinguished from a malformed response — 422 "topic declined" vs 502 — on both non-streaming routes.
- The generation counter (`genRef`) that makes a superseded turn inert — no drawing, no false "taught" mark — is the subtlest thing in the app, and it is the thing with the most deliberate test (jsdom, a stream held open by hand).
- `/api/speak` propagates `req.signal` upstream, so an abandoned narration request stops costing function-duration. (The Claude routes do not — see finding 2.1.)

### 1.5 Replay is stored as data, and shares the live code path

Lessons persist as **blocks and beats, not pictures** — which works only because blocks are already the source of truth. Replay runs through the same `applyBlock` as live teaching, so a replay is the lesson, not an approximation of it. Persistence is per-page as taught, so an abandoned lesson keeps the pages that were paid for; re-teaching a page upserts on `(lesson_id, idx)` instead of stacking copies. Replay deliberately bypasses the spend guard — "a demo that survives a blown budget is most of the point."

### 1.6 The tests stub the minimum and are checked for the ability to fail

Only the Anthropic SDK and `auth` are stubbed; zod, the NDJSON parser, the SSE writer, the guard, and the cap arithmetic are the real code. The usage-recording tests explicitly assert the property the whole cost system depends on ("a call that lands no row is free forever"), including the failure path where the insert dies and the learner still gets their page. The stated discipline — break the covered line and watch the test go red — is the correct one and the code shows evidence of it.

### 1.7 The comment culture is a production asset

Comments record the bug that made the line necessary: the unqualified-column SQL trap, the `OAuthAccountNotLinked` seeding dead end, the O(n²) store-write reveal loop, the tldraw disposal crash, the Proxy-vs-DrizzleAdapter build failure. This is institutional memory checked in next to the code it explains, and it makes the codebase reviewable in a way most are not. `lib/env.ts` failing at boot with _what the variable was for_ is the same philosophy applied to configuration.

### 1.8 Honest self-assessment

The README's "Not done yet" section and the cap-overshoot comment in `lib/limits.ts` say true things about the system's limits ("fine for a cost backstop, not a DoS defence"). A codebase that documents its own known weaknesses accurately is one whose other claims can be trusted — and on verification, they could be.

---

## Part 2 — What needs improvement

Findings are ordered by severity. Severity is calibrated against the actual blast radius: the global cap bounds a worst-case month at $25, so nothing here is "unbounded bill" — the stakes are silent under-counting, lost work, and blindness in production.

### 2.1 HIGH — An interrupted stream is billed by Anthropic but never recorded, and keeps generating

**The one genuine hole in the cost ledger.** In `lib/sse.ts`, the generator is driven entirely inside `ReadableStream.start()`; there is no `cancel()` handler. When the learner interrupts — which is a _routine, designed-for action_ (`ask()` aborts the in-flight `/api/teach` fetch on every question) — the client disconnect cancels the response stream, the next `controller.enqueue` throws, and the generator is abandoned at its yield point. Two consequences:

1. `recordModelUsage(...)` — which runs _after_ the event loop in both `app/api/teach/route.ts:110` and `app/api/draw-panel/route.ts:93` — never executes. The call vanishes from `usage_event`. By the repo's own rule ("a call that is not recorded is free forever"), every interrupted turn under-counts both caps — on the most expensive route, triggered by normal use.
2. Neither route passes `req.signal` to `anthropic.messages.stream(...)` (contrast `/api/speak`, which gets this right). The SDK connection stays open and the model generates the full turn — spend that continues after nobody is listening.

The overshoot comment in `lib/limits.ts` covers concurrent-burst races; it does not cover this, which is systematic rather than racy: heavy question-askers are systematically under-billed.

### 2.2 HIGH — Observability ends at `console.log`, and the alarms have no bell

Every important event is logged in good structured JSON (`{"at":"usage"}`, `{"at":"limit"}`, the under-count warning in `recordUsage`) — and then nothing consumes it. On Vercel Hobby, logs are ephemeral (hours). Concretely:

- The one log line that means "the spend cap is now lying" (`spend not recorded — every cap now under-counts by this call`) is written to a place nobody will see.
- A tripped global cap — the app-wide kill switch firing — pages no one.
- There is no error tracker; a client-side exception in the teaching loop is invisible unless a user reports it.
- The `usage_event` table is a good durable ledger, but nothing reads it for humans: the admin page shows approvals only. "What did this month cost, per user, per route?" requires `db:studio` and hand-written SQL.
- There is no health check endpoint, no build/version stamp in logs, and the latency column (`ms`) — explicitly documented as "the only warning you get that a route is drifting towards the 60s ceiling" — has no consumer watching it drift.

### 2.3 MEDIUM — `checkLimits` scans the entire history of `usage_event` on every model call

The query in `lib/limits.ts:69` has **no outer `WHERE`** — the month and rate-window predicates live only in `FILTER` clauses, which cannot bound the scan. Every model call (~15 per page) pays a scan over _all rows ever written_, growing without bound month over month. The comment ("one scan of one index") is accurate but incomplete: it is one _full_ scan. At current caps (~1,500–2,000 rows/month) this is milliseconds; after a year it is tens of thousands of rows on the hottest path in the app, before every call, forever. It is also the easiest fix in this review (one `WHERE` clause — see plan §1.2).

### 2.4 MEDIUM — Durability of paid work depends on the browser tab

The client drives the loop _and_ owns persistence: a page is saved only by `savePage()` at end-of-turn, from the browser. A closed laptop, crashed tab, or navigation away mid-page loses everything since the last page boundary — work that was already paid for server-side. `savePage` failures are also fire-and-forget with no retry and no user-visible indication, so a lesson can silently end up unreplayable while appearing to succeed. The client-driven _loop_ is the right call for this product (narration pacing is inherently client-side); the client-owned _durability_ is not — the teach route already sees every beat stream through it and could write them down (plan §3.1).

### 2.5 MEDIUM — `max_tokens` truncation is silent, and Opus 5's default thinking makes it likelier

On `claude-opus-5`, **omitting `thinking` runs adaptive thinking by default, and `max_tokens` caps thinking plus text together.** Two routes are exposed:

- `/api/draw-panel` omits `thinking` with `max_tokens: 2000` — so the highest-volume route (~36 calls/lesson) is spending thinking tokens on a task that needs almost none, adding cost and latency, and a thinking-heavy call can truncate the block stream. The `LineParser` drops the trailing partial line by design, so truncation reads as "the model drew less," indistinguishable from success.
- `/api/teach` (`max_tokens: 4000`, `effort: "high"`) never checks `stop_reason` on the final message. A turn cut off at `max_tokens` ends the stream normally: the client marks the page **taught** and saves a partial beat list — violating "never mark a page taught on a path that did not teach it" in a way no current test catches. The streaming routes also never check for `refusal`, which surfaces as an empty drawing with no explanation.

### 2.6 MEDIUM — The 60-second function ceiling is load-bearing and unmonitored

Every route sets `maxDuration = 60` (Hobby ceiling), and the ceiling covers the _whole stream_. `/api/teach` at `effort: "high"` with adaptive thinking is the at-risk route — its own comment says so and points at `docs/plans/2026-08-08-production-readiness.md`, **which does not exist in the repo** (dangling reference). A turn killed at 60s looks like finding 2.5: silent partial page. `ms` is recorded but nothing alerts as it drifts toward 60,000.

### 2.7 LOW-MEDIUM — The unauthenticated surface has no rate limiting

All limits key on an approved user id. Before approval: anyone with a Google account can create a pending row, and each `createUser` fires an email to the admin — a signup loop means an inbox flood and Resend quota burn. `/api/auth/*` and the login page have no per-IP throttling. Bounded (no spend is possible pre-approval), but it is the one part of the perimeter with no backstop at all.

### 2.8 LOW — Lesson creation is not atomic

`POST /api/lessons` inserts the `lesson` row and the `lesson_page` row as two statements over the neon-http driver (which has no transactions). A failure between them leaves an orphan lesson with zero pages, visible in the home list. `db.batch()` exists on this driver and would close the gap.

### 2.9 LOW — Operational bus factor

One admin (`ADMIN_EMAIL`), no second approver path; migrations applied by hand from a laptop (`db:migrate` is documented but not wired into deploy, so schema drift between deploy and migrate is a manual discipline); no staging environment; `approvedBy` is the only audit trail (admin _actions_ beyond approval — future refunds, cap changes — would have none).

### 2.10 LOW — Test blind spots (mostly known)

The mocked-database class of bug is documented honestly (the unqualified-SQL trap "the tests will not catch"). Remaining gaps: no test that a client disconnect records usage (2.1 — currently it can't pass); no `stop_reason` truncation test (2.5); nothing exercises `components/Board.tsx` against a real tldraw editor, where the last regression actually lived (the disposal crash); no visual/geometry snapshot of `renderPanel` output, so a rendering regression that keeps all invariants but looks wrong ships silently.

---

## Part 3 — Explicitly not flagged

Reviewed and judged correct trade-offs, listed so they aren't re-litigated later:

- **Post-hoc cap checking with bounded overshoot** — documented, bounded by in-flight concurrency, correct for a cost backstop.
- **`proxy.ts` as UX-only** — correct, and correctly explained.
- **Client-supplied `pages`/`board`/`transcript` re-sent each turn** — the client is trusted with _content_ but not _spend_; every field is zod-bounded and the caps bound the damage. Fine for approved users.
- **Sessions in the database at a query per request** — the approval-latency property it buys is core UX; correct at this scale.
- **Replay re-synthesizing narration (~$0.08)** and **desktop-only layout** — known, documented, and priced; addressed as improvements, not defects (plan §2.3).
- **`GET /api/lessons` outside `withGuard`** — deliberate and right: replay surviving a blown budget is the point of persistence.
- **Prompt-injection via topic/questions** — blast radius is the user's own lesson plus their own cap. Accepted.

---

## Summary table

| #    | Finding                                                            | Severity | Effort to fix       |
| ---- | ------------------------------------------------------------------ | -------- | ------------------- |
| 2.1  | Interrupted streams: unrecorded usage + continued generation       | High     | S–M (plan §1.1)     |
| 2.2  | No observability consumer: alerts, spend dashboard, error tracking | High     | M (plan §2)         |
| 2.3  | `checkLimits` unbounded full-table scan on hot path                | Medium   | S (plan §1.2)       |
| 2.4  | Lesson durability lives in the browser tab                         | Medium   | M (plan §3.1)       |
| 2.5  | Silent `max_tokens` truncation; draw-panel thinking by default     | Medium   | S (plan §1.3)       |
| 2.6  | 60s ceiling unmonitored; dangling doc reference                    | Medium   | S (plan §1.4, §2.2) |
| 2.7  | No rate limit on signup/auth surface                               | Low-Med  | S–M (plan §4.2)     |
| 2.8  | Non-atomic lesson create                                           | Low      | S (plan §3.2)       |
| 2.9  | Single admin, manual migrations, no audit trail                    | Low      | S–M (plan §4.3)     |
| 2.10 | Test blind spots around 2.1/2.5 and the canvas                     | Low      | M (plan §3.3)       |

The companion document — `docs/plans/2026-08-09-architecture-improvement-plan.md` — turns each of these into concrete, sequenced work.
