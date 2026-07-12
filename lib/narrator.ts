"use client"

// Speaks the lesson aloud. Output only — nothing is ever recorded, and no
// microphone permission is requested.
//
// Synthesis takes about a second, which is dead air at the top of every
// sentence if you wait for it. So a line can be fetched ahead of time while the
// previous one is still playing, and `speak` simply picks up whatever is ready.

type Clip = Promise<Blob | null>

async function synthesise(text: string): Clip {
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    })
    return res.ok ? await res.blob() : null
  } catch {
    return null // a lesson with no sound still teaches; a crashed one doesn't
  }
}

export class Narrator {
  private audio: HTMLAudioElement | null = null
  private prefetched = new Map<string, Clip>()
  /** Set when the browser refuses to play audio without a user gesture. */
  blocked = false

  /** Begin synthesising a line now, so it is ready the moment it is needed. */
  prefetch(text: string): void {
    if (this.blocked) return
    if (!this.prefetched.has(text)) this.prefetched.set(text, synthesise(text))
  }

  /** Plays a line, resolving when it has finished speaking. */
  async speak(text: string): Promise<void> {
    // Once the browser has refused us, stop paying to synthesise audio nobody
    // will hear — until a gesture unblocks it.
    if (this.blocked) return

    const clip = this.prefetched.get(text) ?? synthesise(text)
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
    })
    URL.revokeObjectURL(url)
    if (this.audio === audio) this.audio = null
  }

  /** Cut the narration off mid-sentence — the learner has asked something. */
  stop(): void {
    this.audio?.pause()
    this.audio = null
    this.prefetched.clear()
  }
}
