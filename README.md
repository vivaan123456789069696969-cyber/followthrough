# FollowThrough

Meetings end. Follow-through starts.

A workspace that turns meeting notes into clear, owned actions people can actually follow.

**Status:** Phase 0 (empty app, tooling and CI). See [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md).

## Run it locally

Needs Node 24 (see `.nvmrc`; Next.js requires 20.9 or later).

```bash
npm install
```

```bash
npm run dev
```

The app runs at http://localhost:3000. Phase 0 needs no environment variables.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types, then run TypeScript |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright). Run `npx playwright install chromium` once first |
| `npm run db:migrate` | Apply `supabase/migrations` to the linked Supabase project |
| `npm run db:types` | Regenerate `lib/supabase/types.ts` from the linked project |

## Project docs

| File | Purpose |
|---|---|
| [00-MASTER-PROMPT.md](00-MASTER-PROMPT.md) | Product brief and requirements |
| [CLAUDE.md](CLAUDE.md) | Permanent project rules |
| [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) | Phases and acceptance tests |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Schema and RLS rules |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Every decision made so far |

## Setup guide

Each section lists when it's needed. Copy `.env.example` to `.env.local` and fill it in as you go. Never commit real values. Check each provider's dashboard if a label differs from what's written here.

To generate the random secrets (`TOKEN_ENC_KEY`, `UNSUBSCRIBE_SECRET`, `CRON_SECRET`), run this once for each:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Supabase (Phase 1)

You need two projects, because the RLS tests create and delete data:

- **App project:** your existing project. Copy its URL, anon key, service role key and database connection string into the `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` variables.
- **Test project:** a second project used only for tests. Copy the same four values into the `TEST_SUPABASE_*` variables. Never point these at real data.

Then link the CLI to the project you want to migrate:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

In the app project, under Authentication:

1. Set the **Site URL** to your app URL, and add `http://localhost:3000/**` and your Vercel URLs to the **Redirect URLs**.
2. Turn on the **Email** provider for magic links.
3. Turn on the **Google** provider using the sign-in client from the Google section.
4. Under **SMTP**, connect Resend, using the values from the Resend section. Supabase's built-in email is only suited to light testing.

### Google Cloud (Google sign-in in Phase 1, Calendar and Tasks in Phase 5)

1. **Sign-in:** create an OAuth client of type Web application. Add `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as a redirect URI. Enter its ID and secret in Supabase's Google provider, not in `.env.local`. Sign-in asks only for basic profile and email.
2. **Calendar and Tasks (Phase 5):** enable the Google Calendar API and Google Tasks API. Add `http://localhost:3000/api/google/callback` and your deployed callback URL as redirect URIs. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. **Testing mode:** Calendar and Tasks scopes are sensitive, so the app stays in Testing until Google verifies it. Add each person who will try it under **Test users**. Only they can connect, and Google's limits for Testing apps apply, including refresh tokens that expire after about 7 days.

### Anthropic (Phase 3)

Add your API key to `ANTHROPIC_API_KEY`. The model is set by `ANTHROPIC_MODEL`, and `AI_MONTHLY_CAP_USD` sets the per-user monthly limit.

### Resend (magic links in Phase 1, reminders in Phase 6)

1. Confirm your sending domain shows SPF and DKIM as verified.
2. For Supabase SMTP, use host `smtp.resend.com`, port `465`, username `resend`, and an API key as the password.
3. For reminders, set `RESEND_API_KEY` and `RESEND_FROM`. Emails are only logged until `RESEND_ENABLED=true`.

### Vercel (first deploy)

1. Import the GitHub repo. Vercel detects Next.js.
2. Add the environment variables for each environment. Never prefix server secrets with `NEXT_PUBLIC_`.
3. Reminders use Vercel Cron every 15 minutes. Check that your Vercel plan allows that frequency before Phase 6.

### Sentry (Phase 8)

Create a Next.js project in Sentry and set the `SENTRY_*` variables. Meeting notes, task text and other personal data stay out of error reports.
