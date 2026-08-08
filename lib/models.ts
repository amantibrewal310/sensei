export const TEACHER_MODEL = "claude-opus-5"
export const PANEL_MODEL = "claude-opus-5"

export const TTS_MODEL = "gpt-4o-mini-tts"
export const TTS_VOICE = "alloy"

/** Every Claude model this app can call. */
export type ModelId = typeof TEACHER_MODEL | typeof PANEL_MODEL

/**
 * List price in US dollars per million tokens.
 *
 * Here rather than in lib/usage.ts so a model id and its price sit on adjacent
 * lines: changing one without the other is then a visible omission rather than
 * a silent mispricing. `Record<ModelId, …>` makes forgetting a model a type
 * error, the same trick PAGE_KIND uses in lib/lesson.ts — swap either constant
 * above and this stops compiling until the new model has been priced.
 *
 * List price deliberately, not any promotional rate: a spend cap built on a
 * discount starts under-counting the day the discount lapses.
 */
export const PRICES: Record<ModelId, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
}
