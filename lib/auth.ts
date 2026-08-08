import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { and, eq, ne } from "drizzle-orm"
import { db, accounts, sessions, users, verificationTokens } from "@/lib/db"
import { env } from "@/lib/env"
import { isAdminEmail } from "@/lib/admin"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),

  // Sessions in the database, not in a JWT, and this is the line the approval
  // flow hangs off. A JWT stamps `status` in at sign-in time, so approving
  // someone would not reach them until they signed out and back in — while the
  // page they are sitting on tells them they have been approved.
  session: { strategy: "database" },

  providers: [
    Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }),
  ],

  // Auth.js's own sign-in page would offer the provider list; there is one
  // provider, and the page it replaces has something to say about approval.
  pages: { signIn: "/login", error: "/login" },

  callbacks: {
    session({ session, user }) {
      // Carry the two columns the rest of the app gates on. Without this the
      // session knows the person's name and nothing about whether they may
      // spend anything.
      session.user.id = user.id
      session.user.status = user.status
      session.user.role = user.role
      return session
    },
  },

  events: {
    async signIn({ user }) {
      if (!user.id || !isAdminEmail(user.email)) return

      // Bootstrapping the admin, on every sign-in rather than only at account
      // creation — and the difference is not academic. Seeding this in a
      // migration does not work at all: Auth.js refuses to link a Google
      // account to a pre-existing row by email (`OAuthAccountNotLinked`),
      // because auto-linking on an unverified claim is how accounts get taken
      // over. Doing it only in `createUser` fails differently — sign in once
      // with ADMIN_EMAIL pointing at the wrong address and the row is created
      // pending, so fixing the variable afterwards promotes nobody and there
      // is no admin left to approve you. Checking every sign-in makes the
      // environment variable authoritative and the mistake recoverable.
      //
      // Matched on id rather than email: the row is already identified, and
      // comparing addresses in SQL would need the same case-folding
      // isAdminEmail does, in a second place, in a different language.
      //
      // `ne(role, "admin")` keeps it a no-op once it has happened, so the
      // original approvedAt survives.
      await db
        .update(users)
        .set({ status: "approved", role: "admin", approvedAt: new Date() })
        .where(and(eq(users.id, user.id), ne(users.role, "admin")))
    },
  },
})
