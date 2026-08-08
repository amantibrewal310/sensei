import { describe, expect, it } from "vitest"
import { isAdminEmail } from "@/lib/admin"

// vitest.config.mts sets ADMIN_EMAIL to admin@example.com.

describe("isAdminEmail", () => {
  it("recognises the configured address", () => {
    expect(isAdminEmail("admin@example.com")).toBe(true)
  })

  it("ignores case, because the two sides are typed by different hands", () => {
    // Google returns the address normalised; ADMIN_EMAIL is typed into a file
    // or a Vercel form. A case-sensitive compare leaves the app with no
    // administrator and nothing anywhere saying why.
    expect(isAdminEmail("Admin@Example.com")).toBe(true)
  })

  it("does not promote anybody else", () => {
    expect(isAdminEmail("learner@example.com")).toBe(false)
  })

  it("does not promote a missing address", () => {
    // `user.email` is nullable in Auth.js's own types, and the empty string is
    // what a provider returning nothing looks like once it reaches here.
    expect(isAdminEmail(null)).toBe(false)
    expect(isAdminEmail(undefined)).toBe(false)
    expect(isAdminEmail("")).toBe(false)
  })

  it("is not a prefix or substring match", () => {
    expect(isAdminEmail("admin@example.com.evil.test")).toBe(false)
    expect(isAdminEmail("notadmin@example.com")).toBe(false)
  })
})
