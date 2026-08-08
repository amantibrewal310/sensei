# Setting up the accounts

Four external things, in the order that avoids doing any of them twice. About 25 minutes.

Everything ends up in `.env.local`, which is gitignored (`.env*` with an `!.env*.example` exception),
so nothing here can be committed by accident. **Paste secrets into that file, never into a chat
window or a commit message.**

Start from the template:

```bash
cp .env.local.example .env.local   # if you haven't already
```

---

## Order matters

Vercel first. The Google OAuth client needs your deployed URL as a redirect URI, and registering it
after the fact means going back into the Google console a second time.

```
1. Vercel   → gives you  https://<project>.vercel.app
2. Neon     → gives you  DATABASE_URL, DATABASE_URL_UNPOOLED
3. Google   → gives you  AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET   (needs step 1's URL)
4. Resend   → gives you  RESEND_API_KEY
```

---

## 1. Vercel — get the URL

1. <https://vercel.com/new> → **Import** the `sensei` repo (authorise the GitHub app if asked).
2. Framework preset is detected as Next.js. **Don't add env vars yet** and don't worry if the first
   build fails — it will, because `lib/env.ts` refuses to boot without the API keys, which is the
   behaviour we want.
3. Under **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, then
   redeploy. The lesson should work end to end at this point, with no sign-in yet.
4. Note the production URL: `https://<project>.vercel.app`. **Step 3 needs it.**

> Vercel Hobby caps a function at 60s. Every route already declares `maxDuration = 60`; `/api/plan`
> runs ~15s, so there is room, but a cold start on a slow topic is the thing to watch.

## 2. Neon — Postgres

1. <https://console.neon.tech> → sign in with GitHub → **Create project**.
   Name `sensei`, region closest to your Vercel region (Vercel Hobby defaults to `iad1`, so
   **AWS US East (Ohio/N. Virginia)** keeps the round trip short).
2. On the project dashboard, **Connect** → the connection string panel.
3. Copy **two** strings, and take care to get both:
   - **Pooled** (the default; the host contains `-pooler`) → `DATABASE_URL`
   - Toggle **Direct connection** (or "unpooled") → `DATABASE_URL_UNPOOLED`

```bash
DATABASE_URL=postgresql://…@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://…@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Why both: the app opens a connection per request and needs the pooler, but schema migrations take
locks that a transaction-mode pooler will not hold. Running migrations through the pooled URL fails
in ways that read as random.

4. Add both to Vercel's environment variables as well. **`DATABASE_URL` is now required at boot** —
   `lib/env.ts` validates it, so a deploy without it fails to start rather than failing on the
   first request that needs a database.
5. Create the tables:

   ```bash
   npm run db:migrate
   ```

   Migrations are checked in under `drizzle/`. Re-running is safe; already-applied files are
   skipped.

## 3. Google — the sign-in button

<https://console.cloud.google.com>

**a. Project.** Top-left project dropdown → **New project** → name it `sensei` → create, then make
sure it is the selected project.

**b. Consent screen.** **APIs & Services → OAuth consent screen** (newer accounts show this as
_Google Auth Platform → Branding_).

- User type: **External**
- App name `sensei`, user support email, developer contact email — your own address for all three
- Scopes: **add nothing.** The defaults (`openid`, `email`, `profile`) are all this needs, and they
  are non-sensitive, which is what keeps Google verification out of the picture entirely.

**c. Publish it.** On **Audience**, click **Publish app** and confirm.

> This is the step people miss. Left in **Testing**, only email addresses you have explicitly listed
> as test users can sign in — so an interviewer clicking "Sign in with Google" gets a flat
> _"access blocked"_ and never reaches your approval queue. Publishing with only basic scopes needs
> no verification and shows no warning screen. Your gate is the approval flow, not Google's.

**d. Credentials.** **APIs & Services → Credentials → Create credentials → OAuth client ID**.

- Application type: **Web application**
- Name: `sensei web`
- **Authorised JavaScript origins** — add both:
  ```
  http://localhost:3000
  https://<project>.vercel.app
  ```
- **Authorised redirect URIs** — add both, exactly, including `/api/auth/callback/google`:
  ```
  http://localhost:3000/api/auth/callback/google
  https://<project>.vercel.app/api/auth/callback/google
  ```

Create, then copy the client ID and client secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
The secret is shown once; if you lose it, make a new one rather than hunting.

> Google also offers the whole thing as a JSON download, named
> `client_secret_<id>.apps.googleusercontent.com.json`. It contains the secret in plain text, and a
> browser will save it wherever it last saved anything — which is often the repo. Copy the two
> values out and keep the file somewhere outside the project (`~/.config/sensei/` does fine).
> `client_secret_*.json` is in `.gitignore` so that a copy landing here cannot be committed, but
> the pattern is a backstop, not a plan.

> A trailing slash, `http` where it should be `https`, or a missing `/api/auth/callback/google` all
> produce the same `redirect_uri_mismatch` error page. It names the URI it was sent — paste that
> string into the console rather than retyping it.

**e. Session secret.** Nothing to do with Google, but it belongs in the same pass:

```bash
npx auth secret          # writes AUTH_SECRET into .env.local
```

Generate a **different** value for Vercel (run it again, copy the output) — a production secret that
has ever been on a laptop is not a production secret.

## 4. Resend — the approval email

1. <https://resend.com> → sign up → **API Keys → Create API Key**.
   Permission **Sending access** is enough. Copy it now; it is shown once. → `RESEND_API_KEY`
2. **Skip domain verification.** Resend's shared `onboarding@resend.dev` sender can send to _your own
   verified address_, which is all this needs — the only recipient is you, being told someone is
   waiting. Verifying a domain matters when you email strangers, and this never does.

   > That restriction is why **a learner is never emailed**, including when they are approved. The
   > `/pending` page polls instead, and says so; sessions are read from the database, so an approval
   > lands on its own. If you ever do verify a domain, that is the moment to revisit it.
   >
   > The Resend account must be the one opened with `ADMIN_EMAIL` — otherwise the shared sender
   > refuses, and `lib/email.ts` logs `{"at":"email","ok":false,"status":403}` rather than failing
   > anyone's sign-in.

3. Set `ADMIN_EMAIL` to the address that should get those emails and be allowed into `/admin`.

> **It has to be an account you can sign in to Google with.** It is compared against the address
> Google returns (case-insensitively), and it is the only thing that creates the first approved
> account — everyone else waits for that account to let them in. Set it to an address you cannot
> sign in as and the app has no administrator, with nothing anywhere saying so.
>
> Getting it wrong is recoverable: the check runs on every sign-in, not only when the account is
> created, so fixing the variable and signing in again promotes you.

---

## Check it

```bash
npm run dev
```

Open <http://localhost:3000/learn?topic=anything>. Signed out, you should be bounced to `/login`
with the topic still in the URL — coming back to what you typed is the point of that parameter.
Sign in as `ADMIN_EMAIL` and you land on the lesson; sign in as anything else and you land on
`/pending`, which is what an interviewer sees until you approve them.

The API routes refuse independently of any of that:

```bash
curl -s -X POST localhost:3000/api/plan -H 'content-type: application/json' -d '{"topic":"x"}'
# {"error":"Sign in to continue."}
```

That refusal comes from the route itself, not from the redirect — `proxy.ts` only saves a
signed-out visitor a wasted page load, and is not what stops anyone spending your API budget.

## The finished file

```bash
ANTHROPIC_API_KEY=sk-ant-…
OPENAI_API_KEY=sk-…
DATABASE_URL=postgresql://…-pooler….neon.tech/neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://….neon.tech/neondb?sslmode=require
AUTH_SECRET=…                      # npx auth secret
AUTH_GOOGLE_ID=….apps.googleusercontent.com
AUTH_GOOGLE_SECRET=GOCSPX-…
RESEND_API_KEY=re_…
ADMIN_EMAIL=you@example.com
```

Every one of these also needs to exist in **Vercel → Settings → Environment Variables** for the
deployed app, with `AUTH_SECRET` differing between the two.

---

## If only some of it is ready

They unblock different work, so partial is genuinely useful — send what you have.

| You have                  | What it unblocks                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | ✅ done — schema and migrations. Also unblocks lesson persistence, which is still to come.               |
| `+ AUTH_*`, `ADMIN_EMAIL` | ✅ done — Google sign-in, the pending/approved gate, and every route refusing a caller it does not know. |
| `+ RESEND_API_KEY`        | ✅ done — `/admin`, the approve and reject buttons, and the "someone is waiting" email.                  |
| All of it                 | The spend cap and rate limit, which need a user to attribute cost to                                     |
