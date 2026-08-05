import Anthropic from "@anthropic-ai/sdk"

// The SDK client only. The SSE wire format lives in lib/sse.ts, which the
// browser imports — it must not drag the Anthropic SDK into the client bundle.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})
