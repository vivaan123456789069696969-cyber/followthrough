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
- Vercel plan: Pro, so the 15-minute reminder schedule stays.
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

### CI not active yet (2026-11-05)
- The gh sign-in lacked the `workflow` scope, so the user chose to push without the workflow file. The file is kept at docs/ci-workflow.yml and nothing runs tests on GitHub until it moves to .github/workflows/ci.yml.
- Phase 0's CI requirement stays open. Checks ran locally before pushing.

### Tooling notes (2026-11-05)
- TypeScript stays on 5.x: typescript-eslint supports below 6.1. ESLint stays on 9.x: eslint-plugin-react, import and jsx-a11y do not support 10. Revisit when they do.
- Commit author is set in this repo only: the GitHub login with its noreply address.
