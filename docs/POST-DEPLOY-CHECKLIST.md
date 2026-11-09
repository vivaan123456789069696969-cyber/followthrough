# After you deploy

Do these in order after every first deploy to a new project, and tick through the first group after later ones. Each item says how to check it. Nothing here needs a secret typed into chat: you add values in Vercel and Supabase yourself.

## Every deploy (2 minutes)

- [ ] **The site loads.** Open the app address. The home page shows "Meetings end. Follow-through starts."
- [ ] **Private pages are closed.** Open `/my-day` in a private window. It sends you to sign-in.
- [ ] **Security headers are on.** In a terminal: `curl -sI https://YOUR_APP/sign-in` shows `content-security-policy` and `x-content-type-options`.
- [ ] **Sign in works** with a real email. The link arrives and opens My day.
- [ ] **Add a meeting and notes.** It saves; the notes show under the meeting.
- [ ] **Jobs refuse strangers.** `curl -i https://YOUR_APP/api/cron/reminders` returns 401, and so does `/api/cron/google-sync`.
- [ ] **Database is current.** In the Supabase SQL editor: `select version from supabase_migrations.schema_migrations order by version;` ends with the newest file in `supabase/migrations`.

## First deploy only

### Required
- [ ] **Vercel variables (Production):** `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. Redeploy after changing any `NEXT_PUBLIC_` value.
- [ ] **Supabase Auth:** Site URL is the app address; Redirect URLs include `https://YOUR_APP/auth/confirm` and `https://YOUR_APP/auth/callback`; no `vercel.app` wildcard.
- [ ] **Both databases migrated** (dev and production), with every file in `supabase/migrations`.
- [ ] **Open question: the password check** from the Phase 1 review (see README, Supabase section). Run it once on the dev project before real people sign up.

### AI suggestions (optional)
- [ ] `ANTHROPIC_API_KEY` and `SUPABASE_SECRET_KEY` in Vercel (the second records each run's cost). Press **Suggest actions** on a meeting's notes and confirm suggestions appear.
- [ ] A monthly spending limit set in the Anthropic console. Optional shared limit: `AI_GLOBAL_MONTHLY_CAP_USD`.

### Google Calendar and Tasks (optional)
- [ ] Google Cloud set up as in the README, then `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENC_KEY` in Vercel.
- [ ] **A real round trip** with a Google test user: turn on Calendar events, make a meeting from an event, turn on due dates, confirm a task with a date and see it on the FollowThrough calendar, mark it done and see it leave, then disconnect and check the app is gone from https://myaccount.google.com/permissions.

### Email reminders (optional)
- [ ] `CRON_SECRET` and `UNSUBSCRIBE_SECRET` in Vercel (32+ characters each).
- [ ] The two `vault.create_secret` lines run on the production Supabase project (README, Resend section, step 4). Check: `select name from vault.secrets;` lists `app_url` and `cron_secret`, and `select jobname, schedule from cron.job;` lists `call-app-jobs` at `*/15 * * * *`.
- [ ] Sender chosen and verified in Resend, then `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_ENABLED=true`.
- [ ] Turn reminders on in Settings, open **See what today's email would look like**, then check the job: `select status_code, created from net._http_response order by created desc limit 5;` shows 200s every 15 minutes.
- [ ] A real email arrives, its **Turn off reminders** link works from another browser, and reminders show as off in Settings.

### Error reporting (optional)
- [ ] `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (the same value) in Vercel, then redeploy. Trigger an error on purpose in a preview and check the report in Sentry has no notes, names or emails in it.

## If something is wrong
| Symptom | Likely cause |
|---|---|
| Sign-in link opens a "link expired" page | Opened in a different browser from the one that asked, or the redirect URL isn't allowed in Supabase |
| Settings says "Google isn't set up" | One of the Google variables, `TOKEN_ENC_KEY` or `SUPABASE_SECRET_KEY` is missing in Vercel Production |
| Suggest actions says AI isn't set up | `ANTHROPIC_API_KEY` is missing in Vercel Production |
| Reminders say they aren't being sent | `RESEND_API_KEY`, `RESEND_FROM` or `RESEND_ENABLED=true` is missing; or no Vault secrets, so Supabase never calls the app |
| A deploy fails with a cron message | The Vercel plan allows only daily jobs; keep `vercel.json` to one daily schedule |
