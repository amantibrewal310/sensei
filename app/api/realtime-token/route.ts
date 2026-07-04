import { NextResponse } from "next/server"

export const runtime = "nodejs"

// Mints a short-lived (ephemeral) OpenAI Realtime client secret so the
// browser can open a WebRTC connection directly to OpenAI without ever
// seeing the standing OPENAI_API_KEY.
//
// This uses the current GA "client secrets" endpoint
// (POST /v1/realtime/client_secrets), which superseded the older beta
// "sessions" endpoint (POST /v1/realtime/sessions, now deprecated). The GA
// endpoint returns the ephemeral secret as a top-level `value` field
// (e.g. "ek_...") plus `expires_at`, rather than nesting it under
// `client_secret.value` as the old endpoint did.
export async function GET() {
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime"

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
      },
    }),
  })

  if (!res.ok) {
    return NextResponse.json(
      { error: `realtime client secret request failed: ${res.status}` },
      { status: 502 },
    )
  }

  const data = await res.json()

  return NextResponse.json({
    value: data.value,
    expires_at: data.expires_at,
    model,
  })
}
