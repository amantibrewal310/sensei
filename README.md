# sensei

An AI tutor that **narrates a lesson while drawing it on a whiteboard**. You type a topic; it plans
an outline, then works through it a page at a time — speaking, sketching a diagram beside itself, and
showing code where code is the honest answer. You can interrupt in text, and jump to any page from
the outline at any point.

> Status: early build.

## What makes it interesting

**The model never picks a pixel.** Everything that broke about earlier versions — diagrams drawn on
top of themselves, boxes too narrow for their own labels, content sliced off at a frame's edge — came
from asking an LLM to do spatial arithmetic, which is the thing it is worst at. So the work is split
down the middle:

- **The LLM owns meaning.** Per beat it names a *relationship*: these three things flow into each
  other, these are peers, this is a container and these go inside it, these two sit opposite each
  other. That's the whole vocabulary ([`lib/blocks.ts`](lib/blocks.ts)) and there is not a coordinate
  in it.
- **Code owns geometry.** [`lib/render.ts`](lib/render.ts) turns those relationships into rectangles:
  whether a chain reads across or down, how wide a box has to be for its longest word, where a row
  wraps, when a panel flows into a second column. [`lib/layout.ts`](lib/layout.ts) sizes the grid
  tracks to whatever the panels ended up holding.

Overlap and overflow aren't prevented any more — they're **unrepresentable**. A panel is derived from
its contents, so content cannot outgrow it. There is no collision packer, because there is nothing
left to repair.

The measurements are checked against tldraw's own constants rather than eyeballed
([`lib/measure.ts`](lib/measure.ts)). Being four pixels short there is the difference between "low
memory" and "low / memor / y".

**One topic per page.** A lesson on rate limiting is an outline of eight pages — why, what a limiter
must guarantee, then a page each for fixed window, sliding window log, sliding window counter, token
bucket, leaky bucket, and how to choose. Each page gets an empty canvas and two or three panels.
Cramming all of it onto one board is what made the old version unreadable. The outline is live from
the moment the plan lands, so you can skip ahead to the algorithm you came for and come back to
compare; a page you have already seen returns exactly as you left it.

**Speech and drawing move in lockstep.** The teacher emits one NDJSON beat per line — a sentence,
then the single thing that sentence just described — and beats are applied in order as they stream.
A sentence's shapes are drawn *while it is being spoken*, but the next sentence waits for the last
one to finish.

```
{"type":"speak","text":"A token bucket holds permits, and it refills at a fixed rate."}
{"type":"draw","panel":"bucket","what":"the bucket as a container holding three tokens"}
{"type":"speak","text":"In code it's four lines: refill by elapsed time, then spend one."}
{"type":"code","label":"allow()","lines":["tokens = min(cap, tokens + r * elapsed)","if tokens < 1:","  return False","tokens -= 1","return True"]}
```

Shapes are revealed one at a time, so the picture appears the way a person would draw it. The camera
follows: it zooms to the panel being drawn into and pulls back to the whole page at the end.

**Code is not on the whiteboard.** It used to be drawn as one text shape per line inside a frame,
which meant it inherited every constraint the canvas has and deserved none of them — it couldn't be
selected or copied, couldn't scroll, and competed for panel width with the diagram explaining it. It
now renders as HTML in a pane beside the board ([`components/CodePane.tsx`](components/CodePane.tsx)),
typed out a line at a time, and comes straight from the teacher rather than through a second model.

## Architecture

A single Next.js app. The browser holds session state and drives the loop; the server is stateless
route handlers.

```
Browser (React) ── drives the teaching loop
  ├─ POST /api/plan       → the outline: what pages this lesson has (once)
  ├─ POST /api/board      → one page's panels on a grid (once per page, on entry)
  ├─ POST /api/teach (SSE)      → NDJSON beats for one page
  ├─ POST /api/draw-panel (SSE) → blocks for ONE panel — relationships, no coordinates
  └─ POST /api/speak            → narration audio for one sentence
lib/render.ts   ── blocks → placed shapes. The only thing that picks a coordinate.
lib/layout.ts   ── grid tracks sized to what the panels actually hold.
Canvas (tldraw) ◄── one tldraw page per lesson page; panels are frames
Speaker         ◄── OpenAI TTS, played back one sentence at a time
```

- **Reasoning:** Claude (`claude-opus-4-8`) plans the outline, designs each page's board, teaches, and
  chooses each beat's layout.
- **Canvas:** [tldraw](https://tldraw.dev). Frames clip their children, so a panel physically cannot
  spill onto its neighbour; shape ids are derived from where they belong, so a panel can grow and be
  re-placed without the board flickering.
- **Narration:** OpenAI text-to-speech, synthesised a few beats ahead of when it is due.

Used under the tldraw SDK license, which requires the "Made with tldraw" watermark to remain on the
canvas.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # add your keys
npm run dev                        # http://localhost:3000
```

```
ANTHROPIC_API_KEY   # planning, teaching, and layout
OPENAI_API_KEY      # narration (text-to-speech)
```

Voice is **output only**. The app never requests microphone access and there is no barge-in — you
interrupt by typing, which cuts the narration off mid-sentence. There is no "enable voice" switch:
the lesson simply talks. (A "turn on sound" button appears only if the browser blocks autoplay,
which happens when `/learn` is opened directly rather than reached from the home page.)

## Tests

```bash
npm test        # measurement, block parsing, rendering, layout, NDJSON beats
npx tsc --noEmit
```

The geometry guarantees are the part worth testing, and they are: a box is always wide enough for its
longest word, a chain turns downward rather than being squeezed, a panel is never smaller than its
contents, a block already on the board never moves when the next one arrives, and panels never
overlap however badly the planner stacks them.

## License

MIT
