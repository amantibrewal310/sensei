"use client"

import type { VoiceLayer } from "./types"

// OpenAI Realtime API — GA WebRTC connection.
//
// Verified against the current (GA) OpenAI Realtime docs
// (developers.openai.com/api/docs/guides/realtime-webrtc,
// .../realtime-conversations, and the client/server events reference) as of
// this implementation:
//
// - SDP exchange endpoint is `POST https://api.openai.com/v1/realtime/calls`
//   (the older `/v1/realtime?model=...` endpoint from the beta API is gone).
//   No `?model=` query param is needed — the model is already bound to the
//   session when the ephemeral client secret was minted.
// - Request: `Content-Type: application/sdp`, body = raw SDP offer text,
//   `Authorization: Bearer <ephemeral>`. Response body = raw SDP answer text.
// - `response.create` nests its config under a `response` object using
//   `output_modalities` (GA field name — NOT the old beta `modalities` field),
//   e.g. `{ type: "response.create", response: { output_modalities: ["audio"], instructions: "..." } }`.
// - Assistant text injected via `conversation.item.create` still uses
//   content type `"text"` (not `input_text`/`output_text`, which are for
//   user input / model output respectively).
// - Input audio transcription is OFF by default and must be turned on via
//   `session.update` with `session.audio.input.transcription.model` set
//   (confirmed field path). We enable it right after the data channel opens.
// The session is otherwise unprompted, so the model picks a language from
// whatever it hears on the mic and can drift out of English mid-lesson. Pin it
// in both places that accept instructions: the session, and each response.
const ENGLISH_ONLY =
  "You are the voice of an English-speaking tutor. Always speak English (en-US), " +
  "no matter what language you hear on the microphone or read in a message. " +
  "Never translate, and never switch languages."

export async function createRealtimeVoice(): Promise<VoiceLayer> {
  const tokenRes = await fetch("/api/realtime-token")
  const { value } = await tokenRes.json()
  const EPHEMERAL = value as string

  const pc = new RTCPeerConnection()

  // remote audio playback
  const audioEl = document.createElement("audio")
  audioEl.autoplay = true
  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0]
  }

  // mic
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
  mic.getTracks().forEach((t) => pc.addTrack(t, mic))

  // data channel for client/server events
  const dc = pc.createDataChannel("oai-events")
  let utteranceCb: ((text: string) => void) | null = null

  dc.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === "conversation.item.input_audio_transcription.completed") {
      const text = msg.transcript?.trim()
      if (text && utteranceCb) utteranceCb(text)
    }
  })

  const dcOpen = new Promise<void>((resolve) => {
    if (dc.readyState === "open") resolve()
    else dc.addEventListener("open", () => resolve(), { once: true })
  })

  // Enable input audio transcription as soon as the channel is up — the
  // `conversation.item.input_audio_transcription.completed` event above
  // only fires once this is turned on.
  dcOpen.then(() => {
    dc.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: ENGLISH_ONLY,
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                language: "en",
              },
            },
          },
        },
      }),
    )
  })

  // SDP offer/answer against the GA `/v1/realtime/calls` endpoint.
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${EPHEMERAL}`,
      "Content-Type": "application/sdp",
    },
  })
  await pc.setRemoteDescription({
    type: "answer",
    sdp: await sdpRes.text(),
  })

  return {
    async speak(text: string) {
      await dcOpen
      // Inject the exact words as an assistant message, then request an
      // audio response that speaks them verbatim.
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "assistant",
            content: [{ type: "text", text }],
          },
        }),
      )
      dc.send(
        JSON.stringify({
          type: "response.create",
          response: {
            output_modalities: ["audio"],
            instructions:
              "Speak the text of the message you were just given, verbatim, in a natural voice. " +
              ENGLISH_ONLY,
          },
        }),
      )
    },
    onUserUtterance(cb) {
      utteranceCb = cb
    },
    interrupt() {
      dc.send(JSON.stringify({ type: "response.cancel" }))
    },
    close() {
      mic.getTracks().forEach((t) => t.stop())
      pc.close()
    },
  }
}
