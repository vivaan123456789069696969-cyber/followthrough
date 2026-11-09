# Decisions Log
## Confirmed by user (pre-build)
- Platform: responsive web app
- Stack: Next.js + Supabase, hosted on Vercel
- AI: Anthropic Claude API for task extraction
- Users: single-user now, team-ready data model
- Release scope: first release + Wispr import, Google Calendar, Google Tasks, email reminders
- Auth: Google + email options
- Design: deck as inspiration, improve it
- Wispr Flow: import by paste/file + build connector slot
- Calendar: read meetings + write task deadlines
- Task app: Google Tasks
- Email: Resend
## Answered during build
(Claude Code appends here)

### Infrastructure (2026-11-05)
- Project folder: Desktop\FollowThrough
- Accounts: Supabase, Google Cloud + consent screen, Resend + verified domain, Vercel, Anthropic API key all exist
- App URL: Vercel URLs for now, custom domain later (kept in an env var)
- Resend from / reply-to: PENDING, ask before Phase 6 (env var RESEND_FROM)
- Git: public GitHub repo named followthrough (changed from private on 2026-11-05). MIT license, copyright Volo India. Repo secrets must never reach fork pull requests.
- Tests: separate Supabase project for dev and live tests, run from a developer's machine only. RLS tests in CI use PGlite and need no keys. Never give CI real keys or use `pull_request_target`. No Docker locally.

### Product (2026-11-05)
- Email sign-in: magic link
- Notes: 100,000 character cap; uploads txt, md, vtt, srt, docx
- Timezone: detect from browser, user can change
- Google Tasks: push-only (create, update, complete from the app)
- Calendar deadlines: dedicated "FollowThrough" calendar
- Waiting on others digest: weekly, sent only to the user, off by default
- Delete task: also delete the Google Task and deadline event. Mark done: complete the Google Task and remove the deadline event.
- Model: claude-opus-5-5 via ANTHROPIC_MODEL
- AI cost cap: $5 per user per month, set by env var
- Retention: keep notes by default; user can set auto-delete after N days; manual delete available
- Tracking: Sentry only, personal data scrubbed, no note or task text
- Branding: generated lowercase wordmark, deck palette (adjusted only for contrast), Inter self-hosted
- Seed: deck scenario (Maya Chen, Product sync), local and dev only

### Gaps found in the kit, answered (2026-11-05)
- Snooze: add tasks.snoozed_until. Hides from next actions and pauses reminders; due date unchanged; overdue tasks still count as Overdue.
- Due times: dates only. "X hours before due" replaced by a "1 day before" option plus the morning digest.
- Unverifiable quote: drop the suggestion and show a count of removed suggestions. No needs_check status.
- Overdue reminders: included in the daily digest for up to 7 days.
- Confirming with blanks: allowed. Task keeps a "Needs owner" / "Needs date" badge; blank-owner tasks appear in My tasks.
- Due soon tile: the user's own open tasks due today through the next 7 days, excluding overdue.

### Approved with the Phase 0 plan (2026-11-05)
- ai-task-extraction skill: replace forced tool_choice (400 on current models) with tool_choice auto + strict: true + Zod; replace "temperature low" (400) with output_config.effort; drop 12k-character chunking (100k characters fits one call).

### From the Phase 0 reviews (2026-11-05)
- Supabase projects: production is used only from Vercel. A second project is for local work, seed data and RLS tests.
- Supabase keys: publishable and secret keys; anon and service_role are being retired by Supabase.
- Basic security headers ship from Phase 0. Rate limits and CSP move from Phase 8 to Phase 3.
- Before Phase 1: enable_confirmations stays on so an unconfirmed address can't sign in; check every public table has RLS in the test suite.

### Before Phase 1 (2026-11-05)
- Vercel plan: first said to be Pro; corrected 2026-11-08, Vercel reports the account as Hobby (daily jobs only). Reminders run every 15 minutes from Supabase instead; see Phase 5 and Phase 6.
- Magic-link sender: the user sets it directly in Supabase's SMTP settings, on the verified domain. Not recorded in this public repo.
- Phase 0 approved with the CI check left open.
- RLS tests run on PGlite (real Postgres in-process) as part of npm test, needing no Docker or keys. `npm run test:live` repeats the key checks on the real test project.

### From the Phase 1 reviews (2026-11-05)
- Open, must settle before real users: Supabase's email provider also accepts passwords through its public API, which may let someone plant a password on another person's account. This can only be tested on a real project. Steps are in the README. If confirmed, add a migration that clears passwords on auth.users, with a live test.
- Hosted on Vercel, project `followthrough`, https://followthrough-two.vercel.app. Deployed from the CLI; not yet linked to GitHub for automatic deploys.
- Sign-out ends the session on this device only. All Supabase calls run on the server and session cookies are httpOnly, so there is no browser client.
- Task sources come only from a verified suggestion, copied by the server. Clients can't write a task's quote, locator or suggestion link. Phase 3 needs a server path for confirming.
- A deleted note's quote stays on tasks made from it, so commitments keep their source. Phase 4's retention wording must say so.
- Add by Phase 2 or 3: a per-user storage limit on notes, CAPTCHA on sign-in, and a rule that every route handler calls requireSession.
- Before team features: deleting a creator's account deletes the whole workspace, and any member can delete notes. Revisit both.

### Moving on with Phase 1 open (2026-11-05)
- The user chose to skip connecting Supabase for now and start Phase 2. Phase 2 is built and tested against a fake Supabase server and PGlite.
- Still required before anyone real uses the app: Supabase login, migration, `npm run test:live`, the password risk check, real sign-in by hand.

### Email sign-in (2026-11-06)
- Default Supabase emails use the code flow, so a link must be opened in the browser that asked for it. /auth/confirm (token hash, works in any browser) is built and tested, but Supabase only allows editing email templates once custom SMTP is set up.
- When Resend SMTP is connected: set the Magic Link and Confirm signup templates to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`, on both projects, and change the "Open it in this same browser" note.

### Phase 3, AI suggestions (2026-11-07, approved by the user the same day)
- Structured outputs (`output_config.format` with a Zod schema) instead of a `report_actions` tool. One call, no tool loop, and the schema is enforced by the API. Zod limits the API can't enforce (lengths, counts) are checked on the server.
- No date or owner comes from the model alone. The model returns the exact due words; the server checks they are in the notes and turns them into a date itself, in the user's timezone, from the meeting's date. Anything unclear becomes an open question with the field left blank.
- "We", "you", "the team" and similar never count as an owner.
- Suggestions are written only through the `add_suggestions` database function, which checks every quote against the stored notes again. Tasks from suggestions go through `confirm_suggestion`, which copies the source on the server.
- Limits: per user, $5 a month (`AI_MONTHLY_CAP_USD`) and 10 runs an hour (`AI_HOURLY_LIMIT`). Notes: 60 an hour per user and 5,000,000 characters per workspace, enforced in the database.
- Usage is reserved at its worst-case cost before each call, under a per-user lock, and settled to the real cost with a one-time token only the server sees. Users can't write usage rows directly. Timeouts keep the worst-case charge. `AI_GLOBAL_MONTHLY_CAP_USD` is optional and unset for now.
- Offsets in stored locators count characters (code points), as Postgres does, so emoji don't shift them.
- The database re-checks each suggestion and skips any that fail, instead of rejecting the whole run. Skipped ones are counted with the removed ones.
- A new Suggest run never brings back words already confirmed or dismissed.
- Owners and date wording must match whole words. Date words must be in the quote or the line either side. A speaker is the owner only when they say "I'll" or similar.
- Shifted or backward date wording ("next week", "Friday after next", "last Friday", "the day after tomorrow") is always asked about.
- The skill's "retry once after a validation error" step is dropped: structured outputs make malformed answers rare, and a retry would double the cost.
- Content-Security-Policy with a per-request nonce and `strict-dynamic`, so every page renders per request. Forms may post only to this app, its own Supabase project and Google.
- Browser tests use the fake server as a stand-in Claude API. `npm run test:ai` is the only paid test.

### Phase 4, setup and settings (2026-11-08, approved by the user the same day)
- New accounts see "Choose your sources" once. Finishing or skipping both mark setup done; nothing on it is required.
- Before Phase 5, the Google Calendar card explains what access it will ask for and says "Coming later". Choosing Google Tasks as the destination is saved, and tasks stay in the app until Google is connected. Nothing claims a connection.
- `profiles.task_destination`: `app`, `google_tasks`, or null for "choose later".
- Note auto-delete choices: keep, 30, 90, 180 or 365 days (the database allows 1 to 3650). Deleted daily at 03:17 UTC by pg_cron, using each note creator's setting. Tasks keep their quote.
- Delete account: a database function removes the sign-in record, and cascades remove the personal workspace and everything in it. No server secret key is needed. The user types "delete" first. Phase 5 must revoke Google access before this runs.
- Export: one JSON file of everything the user can read, through their own session, so row-level security applies. Secret columns are never selected.
- From the Phase 4 reviews:
  - AI usage rows are kept when an account is deleted, with the person and note removed, so deleting and signing up again doesn't reset the shared spending total. A returning person does get a fresh personal limit; tying limits to a hashed email is left for later.
  - Deleting an account is refused while the person created a shared workspace others are in. Auto-delete applies to personal workspaces only. Both need revisiting before team features, as does what the export includes from shared workspaces.
  - A device whose account no longer exists is signed out at /auth/ended, which only acts when the account really is gone.
  - Accepted for now: deleting needs only the typed word, not a fresh sign-in. Asking for a new sign-in link needs custom SMTP first (Supabase's built-in mailer allows about 2 emails an hour). Revisit with Resend.
  - Accepted for now: no rate limit on export; the deletion notice comes from a query parameter and shows only fixed text.
- Still open from the Phase 1 review: CAPTCHA on sign-in. It needs a CAPTCHA provider account the user sets up.

### Phase 5, Google Calendar and Tasks (2026-11-09; approved by the user 2026-11-08, with the real Google round trip still owed until Google Cloud is set up)
- Three features, each with its own permission, asked for only when turned on: Calendar events (`calendar.events.owned.readonly`, calendars the person owns only), Due dates in Calendar (`calendar.app.created`, which can only touch calendars the app made), and Google Tasks (`tasks`). Scope names checked against Google's docs on 2026-11-08.
- Own OAuth flow at /api/google/connect and /api/google/callback: PKCE, a random state in an httpOnly cookie bound to the user and valid 10 minutes, offline access, include_granted_scopes. Unticked permissions leave that feature off.
- Tokens are encrypted with AES-256-GCM, bound to the user and token kind, and read only by the server through the Supabase secret key. Users can see which features are on, never tokens.
- Sync runs after the response (Next's `after`), never holding up a page. Failures are recorded on the task with a plain message and Retry, and retried by a 15-minute Vercel Cron job with backoff (1, 2, 4 ... minutes, up to 6 hours, 8 tries). A 401 refreshes once; a dead refresh token marks the connection "needs reconnect" and shows a banner.
- Google Tasks only when it's the chosen destination and a list is picked; the user chooses a list or makes one called FollowThrough. Push-only. Done in the app marks it completed there.
- Due dates: all-day events "Due: {title}" on a FollowThrough calendar made when the feature is turned on. Removed when the task is done or loses its date. Found again by a private property, so retries don't duplicate.
- Meetings from events: the last and next two weeks, read again from Google on the server when created. Attendee names only; emails and rooms aren't stored. One meeting per event.
- Disconnect revokes at Google and forgets the tokens; meetings, tasks and what was already sent to Google stay. Deleting an account does the same first. If Google can't be reached the tokens are still forgotten (Google expires them), and the account deletion only stops if forgetting them fails.
- Not built: deleting tasks (the app has no task deletion yet), reading changes back from Google, showing due dates next to meetings (master prompt 3.8).
- From the Phase 5 reviews:
  - Calendar read narrowed to `calendar.events.owned.readonly`, which Google's events.list reference accepts.
  - Due-date events get a fixed id made from the task id, so retries and lost replies can never make a second event. Creates in Google are never retried automatically; a sync row is claimed before creating, so two runs at once can't both create.
  - Syncs that can't run (disconnected, needs reconnect, destination changed, list or calendar deleted) are set aside with a plain reason on the task, so they don't block the retry job. A deleted calendar can be made again from Settings; a deleted list asks for a new one.
  - Connecting, choosing a list, or choosing Google Tasks as the destination sends the person's open tasks too, not only new ones. Changing the list moves tasks to the new list.
  - All-day events show as a date, and become meetings at midday in the person's timezone.
  - Attendees: display names only; nothing from email addresses.
  - Disconnect and account deletion say so if Google couldn't be reached, and point to myaccount.google.com/permissions.
  - Google's addresses can be pointed at a test server only when `GOOGLE_TEST_ENDPOINTS=true`. `CRON_SECRET` must be at least 32 characters.
  - Accepted for now: Meetings and Settings call Google on each visit (no cache); quick done-then-reopen can leave Google one step behind until the next change; before team workspaces, sync must use the acting member's own connection; tasks keep their quote in Google after notes are auto-deleted.
  - Still to do by hand: one real round trip with a Google test user in Testing mode, since the tests use a stand-in for Google.
- Vercel refused the 15-minute job: the account is on Hobby, which allows scheduled jobs once a day. The user chose daily for now, so the retry job runs at 06:17 UTC. Syncs still run straight after each change, and Retry works any time. Phase 6 reminders need Pro or another schedule; decide before then.

### Phase 6, reminders: answered by the user (2026-11-08)
- Schedule: Supabase's pg_cron calls the app's reminder and Google retry routes every 15 minutes (pg_net), with the app address and job secret kept in Supabase Vault. No Vercel plan change. Vercel's daily Google retry stays as a backup.
- Sender: not chosen yet. Emails are only logged until the user sets RESEND_FROM (and RESEND_API_KEY, RESEND_ENABLED=true) in Vercel.
- Defaults: reminders off until the person turns them on. Then: morning digest at 08:00, "1 day before" off, quiet hours 21:00 to 07:00, all in the person's timezone.

### Phase 6, how it works (2026-11-09, approved by the user the same day; emails send once the secrets and sender are set)
- One digest email a day at most, at the person's chosen time in their timezone. A late run still sends within 3 hours, but never inside quiet hours; a time inside quiet hours waits until they end. A second email within 20 hours is refused, so changing the time or timezone after today's email doesn't bring another.
- Each task is claimed in reminder_log (unique per task, kind and moment) before the email is sent; claims are given back if sending fails or errors. Resend gets an idempotency key per set of claims.
- Contents: due today, overdue for up to 7 days, due tomorrow (if on), and on Mondays the weekly "waiting on others" list (if on). Only the person's own tasks: ones they own, or made for others. Snoozed, done and dismissed tasks are left out. At most 25 per email, most urgent first, with "And N more".
- Unsubscribe: a link signed with UNSUBSCRIBE_SECRET over the user id and their unsubscribe token, POST only, no sign-in, plus List-Unsubscribe and one-click headers. Links don't expire, because unsubscribe must keep working; resetting the token or secret retires them. No email is sent without a working unsubscribe link.
- Log-only mode (no sender yet) keeps claims but never marks anything sent; a real email still goes once sending is on.
- Test switches (simulated clock, stand-in servers) are ignored on Vercel production.
- The pg_net job only sends its secret over https. The migration's revoke on the `net` schema has no effect: Supabase's own admin role granted pg_net to every role, and only it can take that back. This is safe because the `net` schema isn't exposed through the Data API (checked 2026-11-09: only the 2 standard schemas are), so users can't call pg_net or read its queue. Never add `net` to the exposed schemas.

### Phase 7, Wispr Flow import (2026-11-09, approved by the user the same day; sample-export check still open)
- The user has no Wispr Flow export samples or API docs, so the import is generic: when adding notes, choose "Wispr Flow", then paste or upload .txt, .md, .vtt, .srt or .docx. Notes are saved with source `wispr_import` and labelled "Wispr Flow import". A Wispr-specific format can be added from real samples later.
- Only a byte-order mark and stray control characters (not tabs or line breaks) are removed; the words are kept exactly, so quotes still match. Size, type, UTF-8 and emptiness are checked on the server like any upload.
- Sources come from one list (lib/notes/source-list.ts). The direct connection is listed as needing validation, can't be chosen, and shows as "Coming after validation" with no button. Nothing claims a connection.

### Phase 8, choices made by the user (2026-11-09)
- Sentry: built with personal data scrubbed (no note or task text, no emails, no request bodies), and off until SENTRY_DSN is set in Vercel. Nothing is sent without it.
- CI: turned on. The user runs `gh auth refresh -h github.com -s workflow` once to give their GitHub login the permission; then docs/ci-workflow.yml moves to .github/workflows/ci.yml.
- CAPTCHA on sign-in: skipped for now and accepted as a risk. Supabase limits sign-in emails per address and per hour. Revisit if abuse shows up; it needs a Cloudflare Turnstile site the user creates.

### Phase 8, hardening (2026-11-09, approved by the user the same day; this closes the build plan, with the open items listed below and in the checklist)
- Added: a skip-to-content link and room above the phone's bottom bar (WCAG 2.4.1 and 2.4.11); a catch-all error page; a loading skeleton; demo data (`npm run seed`, dev project only); Sentry (off until a DSN is set; reports are rebuilt from a few safe fields, messages with spaces are redacted, no performance data); Permissions-Policy and Cross-Origin-Opener-Policy headers.
- Tests added: an accessibility sweep of every screen in light and dark, at phone and desktop size, plus 320px reflow, keyboard, reduced motion and a check that the scanner catches planted problems; a performance check (slowed phone: main content in about 1 second, under 300 KB of script); the whole-app product test; security headers on public and private pages. Tests that name a weekday use a day that is never today, since "by Friday" said on a Friday is ambiguous and the app asks instead of guessing.
- From the final security review: AI usage can now only be recorded by the server (`reserve_ai_usage` and `settle_ai_usage` are service-role only and take the person's id from their verified sign-in), so people can't write usage with caps they choose or poison the optional shared cap. Suggesting actions therefore needs `SUPABASE_SECRET_KEY` as well as the Claude key. GCM tag length is pinned.
- From the final QA review: re-running the demo script no longer leaves duplicate tasks; it uses the person's timezone.
- Accepted: no per-day caps on meetings, tasks or contacts a signed-in person can create (only their own data is affected); `/api/unsubscribe` has no rate limit (it only reads, and a forged link changes nothing; a Vercel firewall rule would cover it); the Google list and calendar can be created repeatedly by their owner in their own Google account; the test switches (`REMINDERS_TEST_CLOCK`, `GOOGLE_TEST_ENDPOINTS`, `RESEND_TEST_ENDPOINTS`) work anywhere but Vercel production, so they must never be set in Vercel Preview or Production; Sentry's "Prevent Storing of IP Addresses" should be turned on in the Sentry project if it's used.
- Not built, known from the start: deleting tasks, due dates shown next to meetings, a real Google round trip, Wispr export samples, CAPTCHA.
### CI left off for now (2026-11-09)
- The user chose to skip CI after the GitHub permission approval didn't complete. Nothing runs automatically on GitHub; every check runs on the developer's computer before each push (lint, types, unit and database tests, browser tests, build, `npm audit`).
- The workflow is ready in docs/ci-workflow.yml and now also runs the browser tests, with no secrets. To turn it on later: `gh auth refresh -h github.com -s workflow`, approve it on https://github.com/login/device (enter the code, then click Authorize, signed in as the repository owner), move the file to .github/workflows/ci.yml and push.

### CI not active yet (2026-11-05)
- The gh sign-in lacked the `workflow` scope, so the user chose to push without the workflow file. The file is kept at docs/ci-workflow.yml and nothing runs tests on GitHub until it moves to .github/workflows/ci.yml.
- Phase 0's CI requirement stays open. Checks ran locally before pushing.

### Tooling notes (2026-11-05)
- TypeScript stays on 5.x: typescript-eslint supports below 6.1. ESLint stays on 9.x: eslint-plugin-react, import and jsx-a11y do not support 10. Revisit when they do.
- Commit author is set in this repo only: the GitHub login with its noreply address.
