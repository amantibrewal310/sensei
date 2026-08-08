"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Re-renders the pending page every so often, so an approval arrives without
 * anyone being told to press F5.
 *
 * This replaces a promise the app could not keep. The page used to say "you
 * will get an email when it is approved", and nothing sends one: Resend's
 * shared sender only delivers to the address the account was opened with, so
 * the administrator can be written to and a learner cannot. Rather than leave
 * that sentence to be discovered as a lie by someone waiting for a mail that
 * was never going to arrive, the page just notices.
 *
 * `router.refresh()` re-runs the server component, which re-reads the session
 * from the database — which is the property that makes this work at all. With a
 * JWT the status is baked into the token and no amount of refreshing would
 * change what it says.
 */
export function PollForApproval({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(id)
  }, [router, seconds])

  return null
}
