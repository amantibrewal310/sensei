import type { DefaultSession } from "next-auth"

// The `user` row this app stores has two columns Auth.js does not know about,
// and both of them are the whole point — a session that cannot say whether the
// person is approved is a session this app cannot make a decision from.
//
// The adapter selects the full row, so `status` and `role` are already there at
// runtime; this only tells TypeScript so, which is what stops the session
// callback needing a cast.

type Status = "pending" | "approved" | "rejected"
type Role = "user" | "admin"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      status: Status
      role: Role
    } & DefaultSession["user"]
  }
}

declare module "next-auth/adapters" {
  interface AdapterUser {
    status: Status
    role: Role
  }
}
