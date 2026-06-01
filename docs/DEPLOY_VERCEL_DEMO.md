# Deploying the DiSCaScribe web demo to Vercel (free / Hobby)

This hosts the web app at a public URL (e.g. `scribe.disca.ai`), behind a single
shared password, with the OpenAI + Anthropic keys held server-side so users never
provide their own. **Demo / synthetic data only** — see "Before real PHI" below.

No Cloudflare required. Everything below runs on Vercel's free Hobby plan.

---

## How it works

- The app reads both API keys from **server-side environment variables**
  (`apps/web/src/app/actions.ts`, `packages/storage/src/server-api-keys.ts`).
  Keys never reach the browser. Users just use the app.
- Transcription is set to the **OpenAI hosted Whisper API**
  (`TRANSCRIPTION_PROVIDER=whisper_openai`), so there is **no local Python/GPU
  backend** to run — it's a pure cloud deploy.
- All patient data stays in **each user's browser** (encrypted `localStorage`).
  There is no server database. PHI only passes through the server transiently on
  its way to OpenAI/Anthropic.
- A shared-password gate (`apps/web/src/middleware.ts` + `/login`) locks the whole
  site, including the API routes, whenever `DEMO_PASSWORD` is set.

---

## One-time Vercel setup

1. **Import the repo** at <https://vercel.com/new> (connect GitHub, pick this repo).

2. **Project settings → General:**
   - **Root Directory:** `apps/web`
   - Turn **ON** "Include files outside of the Root Directory in the Build Step"
     (the app imports `../packages/*` and `../../config/*`).
   - Framework Preset: **Next.js** (auto-detected). The build command is pinned to
     `next build --webpack` via `apps/web/vercel.json` — leave it as is.

3. **Project settings → Environment Variables** (add to *Production*):

   | Name | Value | Notes |
   |---|---|---|
   | `DEMO_PASSWORD` | *your shared password* | Turns the login wall on. |
   | `ANTHROPIC_API_KEY` | `sk-ant-…` | Note generation. |
   | `OPENAI_API_KEY` | `sk-proj-…` | Whisper transcription. |
   | `TRANSCRIPTION_PROVIDER` | `whisper_openai` | Cloud transcription, no local backend. |
   | `NEXT_PUBLIC_SECURE_STORAGE_KEY` | `openssl rand -base64 32` | Build-time; client storage encryption. |

   `NODE_ENV=production` is set by Vercel automatically (needed for the secure
   cookie + HTTPS redirect).

4. **Deploy.** You'll get a `*.vercel.app` URL. Visit it → you should be bounced to
   `/login` → enter the password → you're in.

5. **(Optional) Custom domain `scribe.disca.ai`:** Project → Domains → add it, then
   create the DNS record Vercel shows (a `CNAME` to `cname.vercel-dns.com`) in the
   `disca.ai` zone. Free on Hobby.

---

## Local check (optional)

```bash
# Production build + run with the gate on:
pnpm build
DEMO_PASSWORD='something' pnpm exec next start apps/web -p 3100
# → http://localhost:3100 redirects to /login
```

Note: in local `next start` the auth cookie is marked `Secure`, which browsers
won't store over plain `http://localhost`. That only affects local prod testing;
on Vercel (HTTPS) it works. For local UI work use `pnpm dev` (gate stays off
unless `DEMO_PASSWORD` is set).

---

## Managing the gate

- **Change the password:** edit `DEMO_PASSWORD` in Vercel and redeploy.
- **Turn the wall off:** remove `DEMO_PASSWORD`.
- **Log out:** visit `/api/auth/logout`.
- The cookie lasts 12h (`SESSION_MAX_AGE_SECONDS` in `apps/web/src/lib/auth.ts`).

---

## Before real PHI (not for tomorrow's demo)

This setup is fine for synthetic data. Before any real patient data:

- **BAAs** with OpenAI and Anthropic (their keys = PHI flows under your accounts).
- Replace the shared password with per-user auth (Clerk/Auth0 email OTP, or
  Cloudflare Access like `../dashboards`).
- Add per-user rate/cost limits (your keys pay for every user's usage).
- Remember browser-local storage is **per-device** — not synced across machines.
