import { describe, expect, it } from "vitest"
import { PRICES, type ModelId } from "../lib/models"
import { costMicros, formatMicros } from "../lib/usage"

// Every model in PRICES, so adding one without pricing it fails here rather
// than silently costing zero in a spend cap.
const MODELS = Object.keys(PRICES) as ModelId[]

const usage = (u: Partial<Parameters<typeof costMicros>[1]> = {}) => ({
  input_tokens: 0,
  output_tokens: 0,
  ...u,
})

describe("costMicros", () => {
  it("prices a million input tokens at exactly the dollar rate", () => {
    for (const model of MODELS) {
      const micros = costMicros(model, usage({ input_tokens: 1_000_000 }))
      expect(micros).toBe(PRICES[model].input * 1_000_000)
      expect(formatMicros(micros)).toBe(`$${PRICES[model].input}.0000`)
    }
  })

  it("prices a million output tokens at the output rate", () => {
    for (const model of MODELS) {
      expect(costMicros(model, usage({ output_tokens: 1_000_000 }))).toBe(
        PRICES[model].output * 1_000_000,
      )
    }
  })

  it("bills cache reads at a tenth of the input rate", () => {
    for (const model of MODELS) {
      const cached = costMicros(
        model,
        usage({ cache_read_input_tokens: 1_000_000 }),
      )
      const fresh = costMicros(model, usage({ input_tokens: 1_000_000 }))
      expect(cached * 10).toBe(fresh)
    }
  })

  it("bills cache writes at 1.25x the input rate", () => {
    for (const model of MODELS) {
      const written = costMicros(
        model,
        usage({ cache_creation_input_tokens: 1_000_000 }),
      )
      const fresh = costMicros(model, usage({ input_tokens: 1_000_000 }))
      expect(written).toBe(fresh * 1.25)
    }
  })

  it("treats the two cache fields as absent when null or undefined", () => {
    // The SDK sends null rather than 0 on models or requests without caching.
    const model = MODELS[0]
    expect(
      costMicros(
        model,
        usage({
          input_tokens: 1000,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        }),
      ),
    ).toBe(costMicros(model, usage({ input_tokens: 1000 })))
  })

  it("does not double-count: input_tokens is the uncached remainder only", () => {
    const model = MODELS[0]
    const split = costMicros(
      model,
      usage({ input_tokens: 400, cache_read_input_tokens: 600 }),
    )
    const allFresh = costMicros(model, usage({ input_tokens: 1000 }))
    // 600 tokens served from cache cost a tenth, so the split must be cheaper.
    expect(split).toBeLessThan(allFresh)
    expect(split).toBe(400 * PRICES[model].input + 60 * PRICES[model].input)
  })

  it("always returns an integer, so summed spend cannot drift", () => {
    const model = MODELS[0]
    for (const n of [1, 7, 333, 1013, 99_999]) {
      const micros = costMicros(
        model,
        usage({
          input_tokens: n,
          output_tokens: n,
          cache_read_input_tokens: n,
          cache_creation_input_tokens: n,
        }),
      )
      expect(Number.isInteger(micros)).toBe(true)
    }
  })

  it("costs nothing for a call that produced nothing", () => {
    expect(costMicros(MODELS[0], usage())).toBe(0)
  })
})

describe("formatMicros", () => {
  it("renders micros as dollars to four places", () => {
    expect(formatMicros(0)).toBe("$0.0000")
    expect(formatMicros(5_000)).toBe("$0.0050")
    expect(formatMicros(1_234_500)).toBe("$1.2345")
  })
})
