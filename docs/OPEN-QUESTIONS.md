# Open Questions — Claude Code MUST ask the user these before coding

Ask in small batches (max 4 at a time, multiple-choice where possible). Record answers in `docs/DECISIONS.md`.

## Accounts & infra (needed before Phase 0)
1. Do you already have: a Supabase project, a Google Cloud project with OAuth consent screen, a Resend account + verified sending domain, a Vercel account, an Anthropic API key? Which are missing?
2. Production domain / app URL (and preview URL pattern)?
3. Resend "from" address (e.g. reminders@yourdomain)? Reply-to?
4. Git host (GitHub?) and repo name?

## Product
5. Email sign-in method: password, magic link, or both?
6. Max pasted note size (propose 100,000 characters) and allowed upload types (txt/md/vtt/srt; add docx/pdf?).
7. Default timezone handling: detect from browser, user can change. OK?
8. Google Tasks sync direction: push-only, or two-way status sync?
9. Calendar deadlines: create on a dedicated "FollowThrough" calendar, or the primary calendar?
10. "Waiting on others" reminders: include a digest for tasks owned by other people?
11. Delete behavior: when a task is deleted in the app, delete the Google Task/Calendar event too?
12. Which Claude model for extraction (default read from env `ANTHROPIC_MODEL`)? Any monthly AI cost cap per user?
13. Data retention: keep raw notes forever or let user auto-delete after N days?
14. Wispr Flow export samples (still open, 2026-11-09): 2 or 3 real, anonymised exports are needed to check the import against Wispr's actual format and to pass Phase 7's "sample exports import into a meeting" check. Until then the import is generic. API docs would be needed for any direct connection.
14. Analytics/error tracking (Sentry, PostHog) wanted? Yes/no.
15. Branding: logo, final colors/fonts, or generate a simple wordmark?
16. Seed/demo content: use the deck's Maya Chen / Product sync scenario?

## Known risks to explain to the user (do not hide)
- **Wispr Flow** has no confirmed public API; this release = paste/file import + adapter slot.
- **Google OAuth:** Calendar and Tasks scopes are sensitive; the app stays in "Testing" mode (limited test users) until Google verification is completed. Explain timeline.
- **Meeting notes go to Anthropic's API** for extraction; the user must be told and consent in-app.
- Team features are not built; schema only.
