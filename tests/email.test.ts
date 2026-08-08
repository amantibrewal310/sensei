import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mailAdmin, mailSignup } from "@/lib/email"

// vitest.config.mts sets ADMIN_EMAIL to admin@example.com and RESEND_API_KEY to
// re_test. Nothing here reaches the network.

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The JSON body of the one request that was made. */
function sent() {
  const [, init] = fetchMock.mock.calls[0]
  return JSON.parse(init.body as string)
}

describe("mailAdmin", () => {
  it("posts to Resend, addressed only to the administrator", async () => {
    fetchMock.mockResolvedValue({ ok: true })
    await mailAdmin({ subject: "hello", text: "body" })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    expect(init.headers.Authorization).toBe("Bearer re_test")
    // The only recipient this app ever has. Resend's shared sender will not
    // deliver anywhere else without a verified domain, so a second address here
    // would be a message that silently never arrives.
    expect(sent().to).toEqual(["admin@example.com"])
    expect(sent().subject).toBe("hello")
  })

  it("logs a refusal with its status and body, and does not throw", async () => {
    // The 403 that the shared-sender restriction produces. Every caller is a
    // side effect of something more important — a person signing in — and
    // failing that because a notification bounced is the tail wagging the dog.
    //
    // But swallowing it silently would be the other failure this codebase
    // dislikes more, so the log line is asserted too: that is the only place
    // this ever surfaces, and a test that only checked "did not throw" would
    // still pass with the whole branch deleted.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "not allowed to send to that address",
    })
    await expect(mailAdmin({ subject: "s", text: "t" })).resolves.toBeUndefined()

    const logged = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => JSON.parse(String(line)))
    expect(logged).toContainEqual({
      at: "email",
      ok: false,
      status: 403,
      detail: "not allowed to send to that address",
    })
  })

  it("does not throw when the network does", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))
    await expect(mailAdmin({ subject: "s", text: "t" })).resolves.toBeUndefined()
  })
})

describe("mailSignup", () => {
  beforeEach(() => fetchMock.mockResolvedValue({ ok: true }))

  it("names who is waiting and links to the page that decides", async () => {
    await mailSignup(
      { name: "Ada", email: "ada@example.com" },
      "https://sensei.example/admin",
    )
    const body = sent()
    expect(body.subject).toContain("ada@example.com")
    expect(body.text).toContain("Ada")
    // Without an absolute URL the link is unclickable from a mail client, which
    // is the only place this message is ever read.
    expect(body.text).toContain("https://sensei.example/admin")
  })

  it("copes with a Google account that has no name", async () => {
    await mailSignup({ name: null, email: "ada@example.com" }, "https://x/admin")
    expect(sent().text).toContain("Someone")
    expect(sent().text).not.toContain("null")
  })
})
