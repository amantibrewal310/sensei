# sensei

An AI tutor that **speaks and draws on a canvas in real time**. You type a topic; a teacher agent
talks you through it step by step while sketching diagrams live — and you can interrupt by voice or
text to ask questions.

> Status: early build. Design spec in [`docs/specs`](docs/specs). This repo is a from-scratch,
> single-app rebuild of a larger three-service prototype, keeping only the parts that make it feel
> alive.

## What makes it interesting

Two ideas do most of the work:

- **NDJSON streaming** — the teacher LLM emits one JSON action per line (`speak`, `draw`, `done`),
  parsed *as it streams*. Speech starts on the first line; drawing fires while the teacher is still
  talking. No "submit → wait → watch."
- **SVG-diff animation** — the teacher describes *what* to draw in plain English; a second model
  turns that into line-level SVG edits (`start_line`, `end_line`, `content`) applied one-by-one with
  a short delay, so diagrams appear like someone sketching them.

## Architecture

A single Next.js app. The browser holds session state and drives the loop; the server is stateless
route handlers.

```
Browser (React) ── drives the teaching loop
  ├─ POST /api/plan           → teaching steps for a topic (once)
  ├─ POST /api/teach   (SSE)  → NDJSON actions for one turn
  ├─ POST /api/draw-svg (SSE) → line-level SVG edits
  └─ GET  /api/realtime-token → ephemeral voice key
Canvas (SVG)  ◄── incremental animated edits
Voice         ◄── OpenAI Realtime (mic + playback + barge-in)
```

- **Reasoning:** Claude (`claude-opus-4-8`) for the teacher brain and the SVG-diff agent.
- **Voice:** OpenAI Realtime for low-latency speech + barge-in.

## Getting started

_Setup instructions land once the app is scaffolded._ Required environment:

```
ANTHROPIC_API_KEY   # teacher + SVG-diff agent
OPENAI_API_KEY      # Realtime voice (ephemeral keys minted server-side)
```

## License

MIT
