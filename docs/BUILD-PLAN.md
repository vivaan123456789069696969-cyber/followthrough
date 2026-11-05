# Build Plan — stop for user approval after each phase

For every phase: implement → tests → run `qa-reviewer` and `security-reviewer` agents → demo summary to user → approval.

## Phase 0 — Plan & scaffold
- Ask all OPEN-QUESTIONS. Create repo, Next.js TS strict, Tailwind, ESLint, Vitest, Playwright, `.env.example`, CI workflow.
- Deliver: written plan, folder tree, env var list, setup guide for Supabase/Google/Resend/Vercel.
- ✅ Accept: `npm run build/lint/typecheck/test` pass on empty app.

## Phase 1 — Auth + schema + RLS
- Migrations from docs/DATA-MODEL.md, signup trigger, Google + email auth, protected routes.
- ✅ Accept: new user gets profile + personal workspace; RLS test suite proves cross-user isolation on every table.

## Phase 2 — Capture, manual tasks, dashboard
- Meetings CRUD, paste/upload notes, manual task create/edit/done, dashboard (My day, My tasks, Meetings), stat tiles, responsive shell.
- ✅ Accept: user can add meeting + notes + manual task and see it on dashboard with correct Due soon/Overdue/Waiting counts (unit-tested date logic in user timezone).

## Phase 3 — AI extraction + review
- Skill `ai-task-extraction`. Route, schema, quote verification, date resolution, review UI with highlight, confirm/edit/dismiss, bulk confirm rule.
- ✅ Accept: golden fixtures (≥8 transcripts incl. no-owner, no-date, relative date, injection attempt, empty, very long) produce expected suggestions; no fabricated owner/date; every suggestion's quote is found in notes.

## Phase 4 — Setup/onboarding + Settings
- "Choose your sources" screen, permission explainer, settings pages, AI-consent notice, export, delete account.
- ✅ Accept: user can finish onboarding skipping everything and still use the app; delete account removes all data.

## Phase 5 — Google Calendar + Google Tasks
- Skill `google-integrations`. Incremental OAuth, encrypted tokens, list events → create meeting, push confirmed tasks to Google Tasks, write due dates to Calendar, sync status UI, retries, disconnect + revoke.
- ✅ Accept: sandbox account round-trip works; revoked token handled gracefully; failures visible and retryable; no token ever reaches the browser.

## Phase 6 — Reminders
- Skill `resend-reminders`. Prefs UI, cron route, quiet hours, idempotency, unsubscribe, deep links.
- ✅ Accept: simulated clock tests for due-today/overdue/digest/quiet-hours; duplicate cron runs send once; unsubscribe works without login.

## Phase 7 — Wispr Flow import adapter
- Skill `wispr-import-adapter`. Import UI + parser + `NotesSource` interface + disabled "Direct connection (coming after validation)" stub.
- ✅ Accept: sample exports import into a meeting; UI never claims a live connection.

## Phase 8 — Hardening & launch
- A11y audit, e2e golden path, perf pass, rate limits, CSP, error pages, seed script, README, deploy to Vercel, post-deploy checklist.
- ✅ Accept: Product test passes end to end: *after a meeting, each person can see their confirmed commitments and next step.*
