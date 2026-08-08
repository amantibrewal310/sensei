import { env } from "@/lib/env"

/**
 * Whether this is the address ADMIN_EMAIL names.
 *
 * Case-folded because the two sides come from different places: Google returns
 * the address normalised, and ADMIN_EMAIL is typed by hand into a file or a
 * Vercel form. One capital letter in `Aman@…` would otherwise match nobody,
 * and the symptom is an app with no administrator in it and no error anywhere
 * saying so — the account just sits in the queue it is supposed to be draining.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()
}
