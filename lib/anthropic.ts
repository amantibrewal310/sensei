import Anthropic from "@anthropic-ai/sdk"
import { env } from "./env"

// The SDK client only. The SSE wire format lives in lib/sse.ts, which the
// browser imports — it must not drag the Anthropic SDK into the client bundle.
//
// Reading the key through `env` rather than `process.env` is what makes all
// four Claude routes validate their configuration transitively: they already
// import this module, so an unset key fails here with a message that names it.
export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
})
