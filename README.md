# sensei

An AI tutor that **narrates a lesson while drawing it on a whiteboard**. You type a topic; a teacher
agent works through it one question at a time, sketching a diagram beside itself as it speaks — and
you can interrupt in text to ask a question.

> Status: early build. Phase 1 (the board) works. Phase 2 (spoken narration) is in progress — today
> the teacher's sentences appear as captions under the canvas.

## What makes it interesting

**The model never picks a pixel.** Everything that broke about the first version — diagrams drawn on
top of themselves, arrows crossing the canvas, labels printed over labels — came from asking an LLM
to do spatial arithmetic, which is the thing it is worst at. So the work is split:

- **The LLM owns meaning.** It designs the board once, up front, deciding what panels the *whole*
  lesson needs and which grid slots they occupy — so space the last question needs is reserved while
  the first question is still drawing. Then, per beat, it draws the contents of a single panel in
  that panel's *local* coordinates.
- **Code owns geometry.** A grid resolves panel collisions ([`lib/layout.ts`](lib/layout.ts)), a
  packer resolves collisions *inside* a panel ([`lib/pack.ts`](lib/pack.ts)), and tldraw routes the
  arrows. A panel cannot overlap another panel, because it never learns where it is on the page.

The rule throughout: **ask the model for good placement, then enforce it.** Prompting alone never
held.

**Speech and drawing move in lockstep.** The teacher emits one NDJSON beat per line — a sentence,
then the single thing that sentence just described — and beats are applied in order as they stream.
You always know what you are looking at, because you just heard why it is there.

```
{"type":"speak","text":"A JavaScript program has just one call stack."}
{"type":"draw","panel":"call-stack","what":"the empty stack, as a tall open box"}
{"type":"speak","text":"Every function you call piles onto it."}
{"type":"draw","panel":"call-stack","what":"three labelled frames stacked inside"}
```

Shapes are revealed one at a time with a short delay, so the picture appears the way a person would
draw it.

## Architecture

A single Next.js app. The browser holds session state and drives the loop; the server is stateless
route handlers.

```
Browser (React) ── drives the teaching loop
  ├─ POST /api/plan       → teaching questions for a topic (once)
  ├─ POST /api/board      → the whole board: panels on a grid + connectors (once)
  ├─ POST /api/teach (SSE)      → NDJSON beats for one turn
  └─ POST /api/draw-panel (SSE) → shapes for ONE panel, in panel-local coordinates
Canvas (tldraw) ◄── panels are frames; connectors are arrows bound to them
```

- **Reasoning:** Claude (`claude-opus-4-8`) plans the lesson, designs the board, teaches, and draws.
- **Canvas:** [tldraw](https://tldraw.dev). Frames clip their children, so a panel physically cannot
  spill onto its neighbour; arrows *bind* to frames, so they route themselves.

Used under the tldraw SDK license, which requires the "Made with tldraw" watermark to remain on the
canvas.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # add your keys
npm run dev                        # http://localhost:3000
```

```
ANTHROPIC_API_KEY   # planning, teaching, and drawing
OPENAI_API_KEY      # narration (Phase 2 — not yet wired)
```

Voice is **output only**: narration played to the speaker. There is no microphone capture and no
barge-in; you interrupt by typing.

## Tests

```bash
npm test        # layout, packing, shape parsing, NDJSON beats
npx tsc --noEmit
```

The geometry guarantees are the part worth testing, and they are: panels never overlap however badly
the planner stacks them, shapes never partially cover one another inside a panel, and a label too
long for its box is cut on a word boundary rather than mid-word.

## License

MIT
