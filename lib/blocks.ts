import { z } from "zod"
import { COLORS } from "./shapes"
import { MAX_LABEL, truncate } from "./measure"

// The vocabulary the model draws with.
//
// There is not a single coordinate in it. Earlier versions asked for x/y/w/h and
// then fought the answer with a collision packer, which is the same spatial
// arithmetic the project set out not to ask an LLM for — it just moved the
// failure from "shapes overlap" to "shapes are a vertical list of squeezed
// boxes". Here the model names a *relationship* — these things flow into each
// other, these are peers, these two sit opposite each other — and lib/render.ts
// computes every rectangle. Overlap is not prevented; it is unrepresentable.

const Color = z.enum(COLORS).default("black")

/** Labels are 1-4 words by instruction; this is the backstop. */
const Label = z
  .string()
  .min(1)
  .transform((t) => truncate(t.trim(), MAX_LABEL))

const Item = z.object({
  text: Label,
  color: Color,
  /** Draws the item filled, for the one thing the sentence is about. */
  emphasis: z.boolean().default(false),
})
export type Item = z.infer<typeof Item>

// Six is a stretch for one beat and two is the instruction. The cap is here so
// a runaway list becomes a short list rather than an unreadable board.
const Items = z.array(Item).min(1).max(6)

const Side = z.object({ label: Label, items: Items })
export type Side = z.infer<typeof Side>

export const Block = z.discriminatedUnion("kind", [
  /** A → B → C. Code picks left-to-right or top-to-bottom by what fits. */
  z.object({ kind: z.literal("flow"), items: Items }),
  /** Peers, side by side, no arrows. Wraps onto more lines when it must. */
  z.object({ kind: z.literal("row"), items: Items }),
  /** A container with things inside it — a call stack, a queue, a buffer. */
  z.object({ kind: z.literal("stack"), label: Label.optional(), items: Items }),
  /** Two columns set against each other — before/after, with/without. */
  z.object({ kind: z.literal("compare"), left: Side, right: Side }),
  /** One thing above the several things it fans out to. */
  z.object({ kind: z.literal("tree"), root: Item, children: Items }),
  /** A short annotation on its own line. */
  z.object({ kind: z.literal("note"), text: Label, color: Color }),
])
export type Block = z.infer<typeof Block>

export function parseBlock(line: string): Block | null {
  try {
    const result = Block.safeParse(JSON.parse(line))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/** What a panel already holds, for the prompt — the blocks themselves, not prose. */
export function describeBlocks(blocks: Block[]): string {
  return blocks.map((b) => JSON.stringify(b)).join("\n")
}

const normalise = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")

/**
 * Drops a block heading that merely repeats the panel's own title.
 *
 * The panel title is already drawn as the frame's label, and the prompt says so,
 * but a model naming a container it has just been told is called "Core
 * Requirements" will call it "Core Requirements" often enough to be worth
 * deleting rather than asking about twice.
 */
export function dropRedundantLabel(block: Block, title: string): Block {
  if (block.kind !== "stack" || !block.label) return block
  return normalise(block.label) === normalise(title)
    ? { ...block, label: undefined }
    : block
}
