"use client"

// Speaks the lesson aloud. Output only — nothing is ever recorded, and no
// microphone permission is requested.
//
// Synthesis takes about a second, which is dead air at the top of every
// sentence if you wait for it. So a line can be fetched ahead of time while the
// previous one is still playing, and `speak` simply picks up whatever is ready.

type Clip = Promise<Blob | null>

async function synthesise(text: string, signal: AbortSignal): Clip {
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    })
    return res.ok ? await res.blob() : null
  } catch {
    return null // a lesson with no sound still teaches; a crashed one doesn't
  }
}

export class Narrator {
  private audio: HTMLAudioElement | null = null
  private prefetched = new Map<string, Clip>()
  /**
   * This generation of narration: every clip being fetched and the one being
   * played. Prefetching runs several beats ahead of the voice, so when the
   * learner interrupts there are typically two or three sentences in flight
   * that nobody will ever hear. Aborting them ends that work rather than
   * abandoning it — the route stops holding a connection open for audio the
   * page has moved past, and anything still queued behind the browser's
   * connection limit is never sent at all.
   */
  private inflight = new AbortController()
  /** Set when the browser refuses to play audio without a user gesture. */
  blocked = false

  /** Begin synthesising a line now, so it is ready the moment it is needed. */
  prefetch(text: string): void {
    if (this.blocked) return
    if (!this.prefetched.has(text)) {
      this.prefetched.set(text, synthesise(text, this.inflight.signal))
    }
  }

  /** Plays a line, resolving when it has finished speaking. */
  async speak(text: string): Promise<void> {
    // Once the browser has refused us, stop paying to synthesise audio nobody
    // will hear — until a gesture unblocks it.
    if (this.blocked) return

    // Read once: `stop` swaps in a fresh controller, and the wait below must
    // watch the generation this line belongs to, not whichever came after it.
    const { signal } = this.inflight

    const clip = this.prefetched.get(text) ?? synthesise(text, signal)
    this.prefetched.delete(text)

    const blob = await clip
    if (!blob) return

    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    this.audio = audio

    try {
      await audio.play()
    } catch {
      // Autoplay policy: the document has had no user gesture. Nothing is broken
      // — the lesson carries on silently and the caption still tells the story.
      this.blocked = true
      URL.revokeObjectURL(url)
      return
    }

    await new Promise<void>((resolve) => {
      audio.addEventListener("ended", () => resolve(), { once: true })
      audio.addEventListener("error", () => resolve(), { once: true })
      // `pause()` fires neither of the above, so without this an interrupted
      // sentence left this promise pending for the life of the page and its
      // object URL never revoked — the audio it points at held in memory once
      // per interruption.
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
    URL.revokeObjectURL(url)
    if (this.audio === audio) this.audio = null
  }

  /** Cut the narration off mid-sentence — the learner has asked something. */
  stop(): void {
    this.audio?.pause()
    this.audio = null
    // Clearing the map only dropped this app's reference to those clips. The
    // requests behind them ran to completion regardless, which is why the
    // abort below is the part that actually stops anything.
    this.prefetched.clear()
    this.inflight.abort()
    // An aborted signal stays aborted, so the next lesson needs its own — this
    // object outlives every interruption, being held for the session's lifetime.
    this.inflight = new AbortController()
  }
}
