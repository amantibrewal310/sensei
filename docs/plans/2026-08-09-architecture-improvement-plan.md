# sensei — Architecture Improvement Plan

**Date:** 2026-08-09
**Companion to:** `docs/reviews/2026-08-09-production-review.md` (finding numbers below refer to it)
**Governing principle:** the current architecture is right — client-driven loop, stateless routes, blocks as the source of truth, geometry in code. This plan hardens it; nothing here replaces it. Each phase is shippable on its own, ordered by (risk retired ÷ effort).

Effort key: **S** = under half a day, **M** = a day or two, **L** = several days.

---

## Phase 0 — What not to change (decided now, so it stays decided)

- **Do not move the teaching loop server-side.** Narration pacing, the generation counter, and interruption are inherently client concerns; a server-side orchestrator would reintroduce session state the design deliberately removed. Fix durability (§3.1), not ownership.
- **Do not add a queue/worker tier, Redis, or a second service.** Nothing in the review needs one at this scale; every fix below fits inside the existing Next.js + Neon shape.
- **Do not "fix" the cap-overshoot race with reservations yet.** Bounded overshoot is documented and acceptable; a reservation ledger (§4.1) is listed as a scale-triggered option only.
- **Keep `drizzle/` migration discipline, integer micros, the guard table test, and the 402/429 split exactly as they are.** These are load-bearing.

---

## Phase 1 — Correctness of the cost ledger and the taught mark (do first)

The theme: the two invariants the app itself declares — *"a call that is not recorded is free forever"* and *"never mark a page taught on a path that did not teach it"* — currently have holes. Close them.

### 1.1 Record and stop interrupted streams (finding 2.1) — **M**

Three coordinated changes:

1. **Propagate abort upstream.** Pass the request signal into both streaming SDK calls so an interrupted turn stops generating (and stops billing):

   ```ts
   const stream = anthropic.messages.stream({ ... }, { signal: req.signal })
   ```

   This mirrors what `/api/speak` already does with `fetch`, and is the single highest-value line in this plan.

2. **Make `sseResponse` shut the generator down.** Add a `cancel()` handler to the `ReadableStream` that calls `gen.return(undefined)`, so the generator's `finally` blocks actually run on disconnect. Guard `enqueue` against the cancelled state rather than relying on the throw.

3. **Record usage in a `finally`, from accumulated events.** Move `recordModelUsage` into `try/finally` around the event loop in both routes. On a clean finish, `stream.finalMessage()` as today. On abort, `finalMessage()` rejects — instead, accumulate what the wire already delivered: `message_start` carries `input_tokens` / cache counters, and each `message_delta` carries the cumulative `output_tokens`. Listen for those two events during the loop and write the last-seen counts. A partial record beats no record, and it is exact for input and near-exact for output at the moment of abort.

**Acceptance:** a route test that cancels the response reader mid-stream and asserts a `usage_event` row was still inserted (this test cannot pass today); a live check that interrupting a lesson produces a `{"at":"usage"}` line with nonzero tokens.

### 1.2 Bound the `checkLimits` scan (finding 2.3) — **S**

Add an outer `WHERE` that lets the `usage_event_created_idx` index range-scan, preserving all three aggregates:

```sql
where created_at >= least(date_trunc('month', now()), now() - interval '60 seconds')
```

The `least(...)` handles the one edge the naive `>= date_trunc('month', now())` misses: during the first 60 seconds of a month, the rate window reaches into the previous month. The `FILTER` clauses stay as they are. Per CLAUDE.md's own rule, run the revised query against Neon once before trusting it (the tests mock the database and will pass regardless — that is exactly the bug class this repo has already documented).

**Acceptance:** `EXPLAIN` on Neon shows an index cond on `created_at` instead of a seq scan; limits tests unchanged and green.

### 1.3 Make truncation and refusal visible on the streaming routes (finding 2.5) — **S**

- **`/api/draw-panel`:** add `output_config: { effort: "low" }`. This is the correct setting for a mechanical emit-two-JSON-lines task on Opus 5 — it keeps adaptive thinking legal, cuts thinking spend on the app's highest-volume route (~36 calls/lesson), and reduces the truncation window inside `max_tokens: 2000`. Measure before/after via `usage_event` (the infrastructure for this comparison already exists — that is what it is for).
- **Both streaming routes:** after the event loop, read `finalMessage()` once (already required for usage) and check `stop_reason`. On `"max_tokens"` or `"refusal"`, emit the existing `error` frame (`sseResponse`'s vocabulary already has it, and the client already renders it) instead of the clean `end`/`done` frame. The client then refuses to mark the page taught — restoring the invariant with zero client changes.
- **`/api/teach`:** raise `max_tokens` to 8000 to match `/api/plan`'s reasoning (thinking + text share the cap; 4000 was sized before that was true for this route's effort level).

**Acceptance:** a routes test where the stub reports `stop_reason: "max_tokens"` asserts the last frame is `error`, and the session-hook test asserts the page is not marked taught.

### 1.4 Fix the dangling reference (finding 2.6) — **S**

`app/api/teach/route.ts:15` cites `docs/plans/2026-08-08-production-readiness.md`, which is not in the repo. Point it at this document (§2.2 covers the timing concern) or delete the reference. Trivial, but a comment that cites a missing document trains readers to distrust the comments — and the comments are this repo's best asset.

---

## Phase 2 — Observability: give the alarms a bell (finding 2.2)

The logging *format* is already right (structured, greppable, one line per event). The work is adding consumers, in increasing order of effort:

### 2.1 A log drain and two alerts — **S**

Attach a drain (Axiom, Betterstack, or Vercel's own — any of them; the JSON lines need no changes) and define exactly two alerts to start:

1. `{"at":"usage","ok":false}` — the spend cap is now under-counting. This is the line that must never be write-only.
2. `{"at":"limit"}` where `why` contains "monthly API budget" — the global kill switch fired.

Add a third, threshold alert on `ms > 45000` for any route — the early warning the `ms` column was built to give (§2.2 of the review).

### 2.2 A `/spend` section on the admin page — **M**

The admin page is the natural home and the auth already exists. One server component, three queries against `usage_event` (all served by existing indexes once §1.2 lands):

- Month-to-date global total vs `GLOBAL_CAP_MICROS`, as a progress bar — "how close is the kill switch."
- Per-user month-to-date vs `USER_CAP_MICROS`.
- Per-route totals and p95 `ms` — which makes cost regressions (like §1.3's effort change) and latency drift toward the 60s ceiling visible without SQL.

Use `formatDollars`/`formatMicros` from `lib/usage.ts`; render with a `leftJoin`/`groupBy` shape per the repo's own SQL rule. This also gives finding 2.6 its consumer: the route drifting toward the ceiling now shows up on a page someone looks at.

### 2.3 Client error reporting — **S–M**

Sentry (or equivalent) on the client only, wired into the existing seams: `app/error.tsx` and the `catch` in `runFrom`/`replay` that currently produces "The lesson stopped: …". The server side can wait — routes already answer `{error}` and the drain captures their logs — but a broken teaching loop in a browser you don't control is currently invisible.

### 2.4 A health endpoint and a version stamp — **S**

`GET /api/health` returning `{ ok, sha }` (from `VERCEL_GIT_COMMIT_SHA`), *unguarded and DB-free* so it stays cheap and can't trip limits; add the sha to the boot log line. Point an uptime monitor at it. Note: new **spending** routes go in the guard table; this one is deliberately outside `withGuard` — add it to `tests/routes.test.ts`'s table with an explicit "no guard, spends nothing" annotation so the exemption is recorded rather than accidental.

---

## Phase 3 — Durability and resilience

### 3.1 Server-side beat capture: durability without moving the loop (finding 2.4) — **L**

The insight: `/api/teach` already sees every beat stream through it. Persist there, and the browser tab stops being the only holder of paid-for work.

- In the teach route's generator, run the streamed text through the existing `LineParser(parseAction)` (it is isomorphic — the client does exactly this) and accumulate beats server-side.
- In the same `finally` as §1.1's usage write, upsert a `lesson_page_draft` row: `(user_id, lesson_id?, page_id, beats, complete: bool)`. An interrupted or 60s-killed turn persists a partial draft; a clean turn persists a complete one.
- Draw-panel results complicate this — the server-side teach beats contain `draw` intents, not the blocks that `/api/draw-panel` later produced. Store the intent beats server-side and let the client's `savePage` remain the authoritative writer of the full replayable page (with blocks folded in), exactly as today. The draft is a **recovery artifact**, not a replay source: on next login, "You have an unfinished lesson on X — resume?" re-teaches from the draft's page index instead of losing the lesson entirely.
- Client hardening in the same change, both **S**: retry `savePage` once on failure, then surface a non-fatal warning ("this page couldn't be saved for replay") instead of today's silence; and send a `navigator.sendBeacon` fallback on `pagehide` with whatever beats have accumulated.

This is deliberately the *smallest* durability design that respects Phase 0: no server-side session, no orchestration moves, one new table, and the recovery UX degrades to exactly today's behavior when the draft is absent.

### 3.2 Atomic lesson writes and idempotency (finding 2.8) — **S**

Wrap the create-lesson + insert-page pair in `db.batch([...])` (supported by neon-http; interactive transactions are not, which is why the code avoids them today). Have the client generate the lesson id (`crypto.randomUUID()`) on lesson start and send it from the first save, making lesson creation idempotent under retry — which §3.1's retry needs anyway, and which removes the orphan-lesson window entirely.

### 3.3 Close the test blind spots (finding 2.10) — **M**

In priority order:

1. The §1.1 cancellation test (usage recorded on disconnect) — locks the ledger invariant.
2. The §1.3 truncation test (`stop_reason: "max_tokens"` → error frame → not marked taught).
3. A geometry snapshot test: `renderPanel` over a fixture set of realistic block lists, snapshotting the placed rectangles. The invariant tests prove nothing *overlaps*; the snapshot catches a change that keeps every invariant but rearranges the board. Cheap because the renderer is pure.
4. (Stretch, **L**) one Playwright smoke against `npm run dev` with the SDK stubbed at the network layer: plan → teach one page → assert shapes on canvas and a `lesson_page` row. This is the only thing that would have caught the tldraw-disposal crash class.

### 3.4 Migrations in the deploy path (finding 2.9) — **S**

Add a CI step (or Vercel build hook) that runs `drizzle-kit migrate` against `DATABASE_URL_UNPOOLED` before promoting a deploy touching `drizzle/`. Keeps the checked-in-history discipline, removes the "deployed code, forgot the migration" window.

---

## Phase 4 — Cost architecture refinements

### 4.1 Panel model economics — **S to try, measured by existing infra**

`PANEL_MODEL` is the dominant cost (~36 Opus calls/lesson; the limits comment already notes a Sonnet move makes "a lesson markedly cheaper"). The block vocabulary is a six-variant discriminated union with 1–4-word labels — a task shaped for a smaller model. Sequence:

1. Ship §1.3's `effort: "low"` first and measure a week of `usage_event`.
2. Try `PANEL_MODEL = "claude-sonnet-5"` — the type system forces the pricing entry ($3/$15 list; use list price per the repo's own rule, and note Sonnet's different tokenizer means comparing *micros*, not tokens). The zod boundary means a weaker model degrades to dropped blocks, never to a broken board — the architecture makes this experiment safe.
3. Only then consider Haiku 4.5 if quality holds.

Keep `TEACHER_MODEL` on Opus — teaching quality is the product; panels are mechanical.

*(Deliberately deferred: a reservation-based limiter. Revisit only if caps rise ~10× or user count makes burst overshoot exceed one lesson.)*

### 4.2 TTS audio caching (README's "replay re-synthesises narration") — **M**

Store synthesized clips in Vercel Blob (or S3) keyed by `sha256(model + voice + instructions + text)`. `/api/speak` checks the store first; a hit streams the blob and **records zero cost** (an honest ledger cuts both ways); a miss synthesizes, records, and writes through. Replay becomes truly zero-marginal-cost, re-taught pages reuse their own sentences, and the cache needs no invalidation story (the key is the content). Keep the existing "failure is silence" behavior — a blob-store outage degrades to today's path.

### 4.3 Signup-surface throttling (finding 2.7) — **S–M**

Two small pieces, neither touching the session-based limiter:

- In the `createUser` event: cap admin signup mail to N per hour (a count against a tiny `mail_event` table, or reuse `usage_event`'s pattern) — an inbox flood becomes one "N people signed up" digest line.
- Per-IP throttling on `/api/auth/*` via the edge (`proxy.ts` may set a counter cookie or use Vercel's WAF rules). This is a *nuisance* control, not a security boundary — consistent with how `proxy.ts` already positions itself.

### 4.4 Operational bus factor (finding 2.9) — **S, mostly policy**

- Document break-glass in `docs/setup.md`: repoint `ADMIN_EMAIL` (the every-sign-in check in `lib/auth.ts` was built to make this recoverable — say so where an operator will look).
- Add an `admin_action` audit row inside `decide()` (actor, target, decision, timestamp). One insert; `approvedBy` stops being the only trail, and future admin surfaces (§2.2's spend page inevitably grows buttons) inherit the habit.

### 4.5 tldraw licensing — decision recorded — **S**

**Decision (2026-08-09): keep tldraw through the pilot, watermark visible.** The watermark alone is not the compliance mechanism — since SDK 4.0, production builds require a license key, and this repo has already seen what happens without one (the unmount-on-timer gate documented in `components/Board.tsx`). Plumbing is wired: `<Tldraw licenseKey={...}>` reads `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` (the one sanctioned exception to the no-`NEXT_PUBLIC_` rule — the key is domain-locked and public by design). Remaining action: request the free-tier key at tldraw.dev and set the variable in the deployment environment.

**Revisit at commercialization:** either the paid business license, or a custom SVG renderer behind the existing `CanvasApi` seam — a 3–5 day project in this codebase specifically, because all geometry is already computed in `lib/render.ts`/`lib/layout.ts` and tldraw is only a display adapter. The costs of that swap are the hand-drawn aesthetic (rough.js + a handwriting font) and recalibrating `lib/measure.ts` to the new font; stored lessons replay unchanged either way, since they persist as blocks, not tldraw documents.

---

## Sequencing summary

| Order | Work | Effort | Retires |
|-------|------|--------|---------|
| 1 | §1.1 abort propagation + finally-recorded usage | M | The cost-ledger hole (2.1) |
| 2 | §1.2 bounded limits query | S | Hot-path degradation (2.3) |
| 3 | §1.3 truncation/refusal frames + panel effort | S | Silent partial pages (2.5) |
| 4 | §1.4 + §2.1 log drain, two alerts | S | Write-only alarms (2.2, 2.6) |
| 5 | §2.2 admin spend page | M | Blind spend (2.2) |
| 6 | §2.3 client error reporting, §2.4 health | S–M | Invisible client failures |
| 7 | §3.2 atomic writes + client-generated ids | S | Orphan lessons (2.8) |
| 8 | §3.1 server-side beat drafts + save retry/beacon | L | Tab-bound durability (2.4) |
| 9 | §3.3 test blind spots, §3.4 deploy migrations | M | Regression classes (2.10, 2.9) |
| 10 | §4.1–§4.5 cost + operational refinements | S–M each | Cost ceiling, replay TTS, bus factor, tldraw key |

Phases 1–2 (items 1–6) are roughly a focused week and retire both HIGH findings. Everything after is incremental and independently shippable.
