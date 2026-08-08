import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"

// The gate for the lesson page, as a layout rather than inside the page.
//
// /learn is a client component — it has to be, it drives a canvas — and a
// client component cannot ask who is signed in without shipping the answer to
// the browser first. A layout runs on the server around it, so the check
// happens before a single byte of the lesson is sent, and the page below stays
// exactly as it was.
//
// This is not the same check proxy.ts does. That saw a cookie; this reads the
// session and can tell approved from pending, which is the distinction the
// whole flow exists for.
export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login?next=/learn")
  if (session.user.status !== "approved") redirect("/pending")
  return children
}
