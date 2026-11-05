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

Link the CLI to the dev and test project. It asks for that project's database password:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_DEV_PROJECT_REF
```

`npm run db:migrate` then applies migrations to the dev and test project. To migrate production, pass its ref explicitly:

```bash
npx supabase db push --remote=YOUR_PRODUCTION_PROJECT_REF
```

In each project, under Authentication:

1. Set the **Site URL** to that project's app URL.
2. Add **Redirect URLs**. Dev and test: `http://localhost:3000/**`. Production: your exact deployed URLs, with no localhost.
3. Turn on the **Email** provider for magic links, and keep **Confirm email** on. Sign-up with a password stays technically possible through this provider, so an unconfirmed address must not get in.
4. Turn on the **Google** provider using the sign-in client from the Google section.
5. Under **SMTP**, connect Resend, using the values from the Resend section.

Production auth settings live in the dashboard. Don't run `supabase config push` against production, because `supabase/config.toml` holds local values such as the site URL.

After migrating the dev and test project, run `npm run test:live` to check signup and isolation there. It creates test users and deletes them when it finishes. Keep these values out of GitHub: `npm test` covers RLS in CI without them.

### Google Cloud (sign-in in Phase 1, Calendar and Tasks in Phase 5)

1. **Sign-in:** create an OAuth client of type Web application. Add `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as a redirect URI, once for each Supabase project. Enter its ID and secret in Supabase's Google provider, not in `.env.local`. Sign-in asks only for basic profile and email.
2. **Calendar and Tasks (Phase 5):** enable the Google Calendar API and Google Tasks API, and add their scopes to the consent screen. Create a second OAuth client for this flow. Add `http://localhost:3000/api/google/callback` and your deployed callback URL as redirect URIs. Put its ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and set `GOOGLE_REDIRECT_URI` to match.
3. **Testing mode:** Calendar and Tasks scopes are sensitive, so the app stays in Testing until Google verifies it.
   - Only people listed under **Test users** can authorize it, up to 100.
   - Each authorization expires after 7 days, so test users must reconnect weekly.
   - The status is set per Google Cloud project. To allow Google sign-in for everyone before verification, keep sign-in and Calendar/Tasks in separate Google Cloud projects.
   - Publishing without verification shows users an "unverified app" warning for these scopes.

### Anthropic (Phase 3)

Add your API key to `ANTHROPIC_API_KEY`. The model is set by `ANTHROPIC_MODEL`, and `AI_MONTHLY_CAP_USD` sets the per-user monthly limit.

### Resend (magic links in Phase 1, reminders in Phase 6)

1. Confirm your sending domain shows SPF and DKIM as verified.
2. For Supabase SMTP, use host `smtp.resend.com`, port `465`, username `resend`, an API key as the password, and a sender address on your verified domain.
3. For reminders, set `RESEND_API_KEY` and `RESEND_FROM`. Emails are only logged until `RESEND_ENABLED=true`.

### Vercel (first deploy)

1. Import the GitHub repo. Vercel detects Next.js.
2. Add the production environment variables. Never prefix server secrets with `NEXT_PUBLIC_`.
3. Reminders run from Vercel Cron. The Hobby plan allows one run per day at an imprecise time, and the Pro plan allows one per minute. See [docs/DECISIONS.md](docs/DECISIONS.md) for the schedule in use.

### Sentry (Phase 8)

Create a Next.js project in Sentry and set the `SENTRY_*` variables. Meeting notes, task text and other personal data stay out of error reports.

## Turn on CI

The CI workflow isn't active yet. To turn it on, grant `gh` the `workflow` scope, then move `docs/ci-workflow.yml` to `.github/workflows/ci.yml` and push.

```bash
gh auth refresh -h github.com -s workflow
```

## License

[MIT](LICENSE)
