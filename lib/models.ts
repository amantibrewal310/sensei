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

/**
 * What a character of narration costs, in micros. An estimate, and labelled one.
 *
 * OpenAI prices this model by tokens in and *audio* tokens out, neither of which
 * a route can know before it has the audio — but it does know how many
 * characters it sent. At roughly $0.015 a minute and roughly 900 characters a
 * minute of speech, that is 15,000 / 900 ≈ 17 micros per character.
 *
 * It is here rather than omitted because a spend cap that silently ignores one
 * of the two vendors it is capping is not a spend cap. It is deliberately a
 * round number on the generous side: the failure worth avoiding is a cap that
 * under-counts, and narration is a small fraction of a lesson either way.
 */
export const TTS_MICROS_PER_CHAR = 17
