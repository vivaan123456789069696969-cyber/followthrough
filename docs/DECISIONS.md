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
- Git: private GitHub repo named followthrough
- Tests: separate Supabase project for dev and RLS tests, also run in GitHub Actions. No Docker locally.

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

### Tooling notes (2026-11-05)
- TypeScript stays on 5.x: typescript-eslint supports below 6.1. ESLint stays on 9.x: eslint-plugin-react, import and jsx-a11y do not support 10. Revisit when they do.
- Commit author is set in this repo only: the GitHub login with its noreply address.
