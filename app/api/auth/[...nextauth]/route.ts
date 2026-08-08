import { handlers } from "@/lib/auth"

// Sign-in, callback, sign-out and session, all of them. The catch-all is
// Auth.js's contract, and the callback path it forms —
// /api/auth/callback/google — is the string that has to match what the Google
// console was told, character for character.
export const runtime = "nodejs"

export const { GET, POST } = handlers
