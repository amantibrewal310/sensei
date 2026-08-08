"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db, users } from "@/lib/db"
import { assertAdmin } from "@/lib/guard"

// A server action is a boundary like any route handler: its arguments arrive
// over the wire from a client that can send anything, and the endpoint has a
// name that can be called without ever rendering the page that defines it. So
// the same two rules apply here as in app/api — check who is asking, then zod
// what they sent.
const Decision = z.object({
  userId: z.string().min(1).max(64),
  status: z.enum(["approved", "rejected"]),
})

export async function decide(input: z.infer<typeof Decision>): Promise<void> {
  const admin = await assertAdmin()
  const { userId, status } = Decision.parse(input)

  // The one move that cannot be undone from this page: rejecting the only
  // account that can approve anyone leaves the app with no way back in except
  // SQL. The button for it is not rendered, and that is not a check.
  if (userId === admin.id) throw new Error("an admin cannot change their own status")

  await db
    .update(users)
    .set({
      status,
      // Cleared on rejection so the column never claims an approval that was
      // taken back. `approvedBy` is kept either way — who made the call is the
      // part worth still having later.
      approvedAt: status === "approved" ? new Date() : null,
      approvedBy: admin.id,
    })
    .where(eq(users.id, userId))

  revalidatePath("/admin")
}
