# FollowThrough

Meetings end. Follow-through starts.

A workspace that turns meeting notes into clear, owned actions people can actually follow.

**Status:** Phase 1 (sign-in, schema and row level security). See [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md).

## Run it locally

Needs Node 24, version 24.15 or later (see `.nvmrc`).

```bash
npm install
```

```bash
npm run dev
```

The app runs at http://localhost:3000. Without Supabase settings, the public pages work and sign-in says it isn't set up.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types, then run TypeScript |
| `npm test` | Unit tests, plus RLS tests on an in-process Postgres. Needs no keys or Docker |
| `npm run test:live` | Signup and isolation checks on the real dev and test project. Needs the `TEST_SUPABASE_*` values |
| `npm run test:e2e` | Browser tests against a production build (Playwright). Run `npx playwright install chromium` once first |
| `npm run test:ai` | Sample notes against the real Claude API. Needs `ANTHROPIC_API_KEY` and costs about $1 |
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

Each section lists when it's needed. Copy `.env.example` to `.env.local` and fill it in as you go. Never commit real values. If a label in a provider's dashboard differs from what's written here, trust the dashboard.

To generate the random secrets (`TOKEN_ENC_KEY`, `UNSUBSCRIBE_SECRET`, `CRON_SECRET`), run this once for each:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Supabase (Phase 1)

You need two projects, so real data is never on your machine or in tests:

| Project | Used by | Variables |
|---|---|---|
| **Production** | Vercel only | `NEXT_PUBLIC_SUPABASE_*` and `SUPABASE_SECRET_KEY` in Vercel |
| **Dev and test** | Local work, seed data, RLS tests | The same variables in `.env.local`, plus `TEST_SUPABASE_*` with the same values |

Use the publishable and secret keys, not the older `anon` and `service_role` keys, which Supabase is retiring.

Use new, empty projects, with the Data API on and `public` exposed. The migration fails on a project that used Supabase's starter template, and it needs Postgres 15 or later. Find each project's URL and keys in its **Connect** dialog.

Migrate before anyone signs in, because accounts created earlier won't have a profile. In `.env.local`, use `http://localhost:3000` for `NEXT_PUBLIC_APP_URL` and open the app at that same address, not `127.0.0.1`, or sign-in links will fail.

Link the CLI to the dev and test project. It asks for that project's database password:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_DEV_PROJECT_REF
```

`npm run db:migrate` then applies migrations to the dev and test project. Run `npm run db:types` straight after, which replaces the temporary hand-written types. To migrate production, pass its ref explicitly:

```bash
npx supabase db push --remote=YOUR_PRODUCTION_PROJECT_REF
```

In each project, under Authentication:

1. Set the **Site URL** to that project's app URL.
2. Add **Redirect URLs**. Dev and test: `http://localhost:3000/**`. Production: `https://YOUR_APP/auth/callback**`, with no localhost. Never add a wildcard covering all of `vercel.app`: anyone can host a site there, and sign-in links could then be sent to it.
3. Turn on the **Email** provider for magic links, and keep **Confirm email** on.
4. Turn on the **Google** provider using the sign-in client from the Google section.
5. Under **SMTP**, connect Resend, using the values from the Resend section.
6. Check these are set: anonymous sign-in off, manual linking off, minimum password length 12, secure password change on, double email-change confirmation on.

Production auth settings live in the dashboard. Don't run `supabase config push` against production, because `supabase/config.toml` holds local values such as the site URL.

**Check before real users sign up:** the email provider also accepts passwords through Supabase's public API, even though this app has no password screen. On the dev project, try this with an inbox you control: sign up with a password through the API, click the confirmation link, then try signing in with that password. See the open item in [docs/DECISIONS.md](docs/DECISIONS.md).

After migrating the dev and test project, run `npm run test:live` to check signup and isolation there. It creates test users and deletes them when it finishes. Keep these values out of GitHub: `npm test` covers RLS in CI without them.

### Google Cloud (sign-in in Phase 1, Calendar and Tasks in Phase 5)

1. **Sign-in:** create an OAuth client of type Web application. Add `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as a redirect URI, once for each Supabase project. Enter its ID and secret in Supabase's Google provider, not in `.env.local`. Sign-in asks only for basic profile and email. Set up the consent screen first. While the app is in Testing, add yourself as a test user, or Google refuses with `access_denied`.
2. **Calendar and Tasks (Phase 5):**
   - Enable the **Google Calendar API** and the **Google Tasks API**.
   - On the consent screen's data access page, add these three scopes. Each is asked for only when someone turns on that feature:
     - `https://www.googleapis.com/auth/calendar.events.owned.readonly` (Calendar events: read meetings on calendars the person owns)
     - `https://www.googleapis.com/auth/calendar.app.created` (Due dates: a separate FollowThrough calendar, and only that calendar)
     - `https://www.googleapis.com/auth/tasks` (Google Tasks)
   - Create a second OAuth client of type Web application. Add `http://localhost:3000/api/google/callback` and `https://YOUR_APP/api/google/callback` as redirect URIs.
   - Put its ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and set `GOOGLE_REDIRECT_URI` to the callback for that environment.
   - Also needed, in `.env.local` and Vercel:
     - `TOKEN_ENC_KEY`, made with the command above. It encrypts Google tokens. Changing it later disconnects everyone.
     - `SUPABASE_SECRET_KEY`, the project's secret key. Only the server uses it, to read tokens and sync tasks.
     - `CRON_SECRET`, made with the command above. Vercel sends it to the sync retry job set in `vercel.json` (daily on the Hobby plan; every 15 minutes is possible on Pro).
   - Until all of these are set, Settings says Google isn't set up, and everything else works.
3. **Testing mode:** Calendar and Tasks scopes are sensitive, so the app stays in Testing until Google verifies it.
   - Only people listed under **Test users** can authorize it, up to 100.
   - Each authorization expires after 7 days, so test users must reconnect weekly.
   - The status is set per Google Cloud project. To allow Google sign-in for everyone before verification, keep sign-in and Calendar/Tasks in separate Google Cloud projects.
   - Publishing without verification shows users an "unverified app" warning for these scopes.

### Anthropic (Phase 3)

Add your API key to `ANTHROPIC_API_KEY`, in `.env.local` and in Vercel's production settings. Without it, the app works as before and the Suggest actions button says AI isn't set up.

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model used to find commitments |
| `ANTHROPIC_EFFORT` | `medium` | How much the model thinks before answering |
| `AI_MONTHLY_CAP_USD` | `5` | Spending limit per user per month |
| `AI_HOURLY_LIMIT` | `10` | Suggest runs per user per hour |
| `AI_GLOBAL_MONTHLY_CAP_USD` | none | Optional limit for all users together, per month |

Each run is charged its worst possible cost before Claude is called, then corrected to the real cost. A run that times out keeps the worst-case charge. Also set a spending limit on your Anthropic workspace, so a mistake here can't run up a bill.

`npm run test:ai` runs the sample notes in `tests/fixtures/extraction.ts` against the real API, to check the prompt still behaves. It uses your key and costs about $1 a run. Nothing else in the test suite calls the API.

### Resend (magic links in Phase 1, reminders in Phase 6)

1. Confirm your sending domain shows SPF and DKIM as verified.
2. For Supabase SMTP, use host `smtp.resend.com`, port `465`, username `resend`, an API key as the password, and a sender address on your verified domain.
3. For reminders, in Vercel (Production):
   - `RESEND_API_KEY`: a Resend API key with sending access.
   - `RESEND_FROM`: the sender, on your verified domain, for example `FollowThrough <reminders@yourdomain.com>`. `RESEND_REPLY_TO` is optional.
   - `UNSUBSCRIBE_SECRET`: made with the command above, at least 32 characters. Without it no reminder is sent, because every email needs a working unsubscribe link.
   - `RESEND_ENABLED=true`. Until then emails are only logged.
4. **Schedule (Supabase calls the app every 15 minutes).** The Phase 6 migration sets up the job; it does nothing until Supabase knows the app's address and the job secret. On the production project, in the SQL editor, run these two lines with your own values (the same `CRON_SECRET` as in Vercel):

   ```sql
   select vault.create_secret('https://YOUR_APP', 'app_url');
   select vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');
   ```

   Each run sends due reminders and retries Google syncs. To change a value later, use `vault.update_secret`.
5. Reminders are off for everyone until each person turns them on in Settings. The morning email goes at their chosen time in their own timezone, waits out quiet hours, and is sent once per day, however often the job runs. Settings has a preview of today's email.

### Vercel (first deploy)

1. Import the GitHub repo. Vercel detects Next.js.
2. Add the production environment variables, including `NEXT_PUBLIC_APP_URL`, because production won't start sign-in without it. Never prefix server secrets with `NEXT_PUBLIC_`. Scope `SUPABASE_SECRET_KEY` and later server secrets to **Production** only, and point Preview at the dev project, so code in a preview build can't reach production data. `NEXT_PUBLIC_*` values are built in, so redeploy after changing them.
3. Scheduled jobs: Supabase calls the reminder and Google sync routes every 15 minutes (see the Resend section). Vercel Cron also runs the Google retry once a day as a backup, which fits the Hobby plan.

### Sentry (Phase 8)

Create a Next.js project in Sentry and set the `SENTRY_*` variables. Meeting notes, task text and other personal data stay out of error reports.

## Turn on CI

The CI workflow isn't active yet. To turn it on, grant `gh` the `workflow` scope, then move `docs/ci-workflow.yml` to `.github/workflows/ci.yml` and push.

```bash
gh auth refresh -h github.com -s workflow
```

## License

[MIT](LICENSE)
