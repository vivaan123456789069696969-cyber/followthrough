# FollowThrough — Master Build Prompt

You are the lead engineer building **FollowThrough**, a responsive web app. Read `CLAUDE.md` first (permanent rules), then this file, then `docs/OPEN-QUESTIONS.md`.

**Before writing any code:** ask the user every question in `docs/OPEN-QUESTIONS.md` and any new doubt you find. Do not assume. After answers, present the Phase 0 plan and wait for approval.

---
## 1. Product
**Name:** FollowThrough · **Tagline:** Meetings end. Follow-through starts.
**One line:** A workspace that turns meeting notes into clear, owned actions people can actually follow.

**Problem (from the concept deck):** After a meeting, commitments are scattered and memory takes over. Decisions sit in notes, owners are implied, deadlines are fuzzy, follow-up lives in too many places. People ask "Who was going to send that?"

**Core flow (4 steps):**
1. **Capture** — bring in meeting notes (paste, upload file, or Wispr Flow export).
2. **Review** — AI suggests actions; user confirms task and sees the source.
3. **Assign** — user sets owner and due date.
4. **Follow through** — dashboard shows progress and next actions; reminders nudge.

**Principle:** Keep the human in control of what becomes work. Every suggested action keeps a link to the words it came from.

**Product test (acceptance of the whole app):** After a meeting, can each person see their confirmed commitments and the next step?

## 2. Users and scope
- **Now:** single user, each with a private personal workspace.
- **Data model must be team-ready** (workspaces, members, roles, owner as a person record) but **no team UI** (no invites, no shared views) in this release.
- Owner of a task may be: the user, or a named person who is not a user (stored as a contact name). Design so a contact can later be linked to a real member.

## 3. Features in this release

### 3.1 Auth
Google sign-in AND email option (Supabase Auth; email = decide with user: password or magic link — see open questions). On first sign-in create profile + personal workspace. Sign-out, delete account (deletes all data + revokes Google tokens).

### 3.2 Onboarding / Setup ("Setup fits the tools people already use")
Screen "Choose your sources". Three cards, each optional, skippable, changeable later in Settings:
- **Wispr Flow** — "Meeting notes and transcripts". Honest state: label *Import* (paste/upload). Do NOT show a fake "Connected" state. Include a small note: direct connection needs validation.
- **Google Calendar** — "Meeting context and schedule" → "Connect calendar" (OAuth, incremental authorization).
- **Task destination** — "Keep work here or sync elsewhere" → options: *In this app* (default), *Google Tasks*, or *Choose later*.
Setup principles shown on screen: **Optional by default · Clear permissions · Personal dashboard.** Before each OAuth, show a plain-language list of what access is requested and why.

### 3.3 Capture
- Create a **Meeting** record: title, date/time, optional attendees (names), optional link to a Calendar event.
- Add notes by: paste text, upload `.txt` / `.md` / `.vtt` / `.srt` / `.docx`(optional, ask user), or Wispr import (see skill `wispr-import-adapter`).
- Preserve original text immutably (`meeting_notes.raw_text`) — source quotes point into it.
- Timestamps: if transcript has them (e.g. `14:32`, VTT cues), parse and keep as locators.

### 3.4 AI extraction (see skill `ai-task-extraction`)
- Server route calls Anthropic Claude API with structured output (tool use + Zod validation).
- Returns suggestions: `title`, `owner_name|null`, `due_date|null`, `due_date_basis` (quote that justified date), `source_quote` (verbatim), `source_locator`, `confidence`, `open_questions[]` (what is unclear).
- Rules: never guess owner/date; relative dates ("Thursday") resolve using the meeting date + user timezone and show the resolved date for confirmation; server verifies quote is a substring of notes; dedupe near-duplicates; cap output; handle long notes by chunking.
- Show loading, empty ("No actions found — add one manually"), and error states.

### 3.5 Review screen (deck slide 6)
Two-pane: left = notes with highlighted source span (click suggestion → scroll/highlight quote); right = Suggested action card: quoted text, source label ("meeting transcript · 14:32"), **Task details** form (Task, Owner, Due date) with fields left blank when unknown and flagged "Needs owner" / "Needs date". Buttons: **Confirm task**, **Edit details**, **Dismiss**. Keyboard shortcuts for confirm/next. Bulk "confirm all complete suggestions" allowed only for suggestions with owner AND date present, with a summary dialog first. Manual "Add action" also available.

### 3.6 Dashboard (deck slide 5) — "What needs me?"
Left nav: **My day · My tasks · Meetings · Settings**. Header: "Good morning, {first name}" + today's date (time-of-day aware greeting). Three stat tiles: **Due soon**, **Overdue**, **Waiting on others**. List "Your next actions" sorted by urgency, each: title, source meeting, due label (Today / Tomorrow / weekday). Calm, not a noisy task list: max ~5 visible, "View all" link. Task detail drawer: title, owner, due, status, source quote with "Open in notes", activity log, mark done, snooze, edit.
- "Waiting on others" = confirmed tasks whose owner is not the user.
- Status: `open`, `done`, `dismissed`. Overdue computed from due date + timezone.

### 3.7 Reminders (deck slide 7) — email via Resend (see skill `resend-reminders`)
- Reminder with context: "Due today · Send revised launch brief · From Product sync · Open task" (deep link).
- User settings: reminder timing (e.g. morning digest at chosen time, plus "X hours before due"), **quiet hours**, timezone, on/off, per-type toggles (due today, overdue, upcoming digest).
- Cron-driven (Vercel Cron → secured route), idempotent via `reminder_log`, one-click unsubscribe link in every email, honor quiet hours.
- Reminders only for tasks the user owns (and optionally "waiting on others" digest — ask user).

### 3.8 Task destinations (deck slide 7 "Where tasks can go")
- **In this app** — complete starting point.
- **Google Tasks** — on confirm, create task in a chosen list; two-way status? **Ask user**; default one-way push + status sync on mark-done in app. Store Google task id; handle edit/delete/failed-sync with retry + visible sync status.
- **Calendar** — write task due dates as calendar events (all-day) on the user's calendar (separate "FollowThrough" calendar preferred; ask user). Show deadlines next to meetings.

### 3.9 Google Calendar read (meetings)
List upcoming/past events (read-only scope), let user create a Meeting from an event (title, attendees, time prefilled) and attach notes. Use skill `google-integrations`.

### 3.10 Settings
Profile, timezone, sources (connect/disconnect each), task destination, reminder preferences, data export (JSON), delete account.

## 4. Non-functional requirements
- Responsive: 360px phone → desktop; left nav collapses to bottom bar on mobile.
- Performance: dashboard LCP < 2.5s on mid-range mobile; extraction shows progress; streaming optional.
- Security: RLS everywhere, encrypted tokens, CSRF-safe routes, rate-limit AI + import endpoints, input size caps (ask user for max note size; propose default 100k chars), no PII in logs, CSP headers.
- Privacy: meeting notes are sensitive. Send to Anthropic API only on explicit user action; disclose this in-app; do not store prompts beyond what is needed; provide delete.
- Accessibility: WCAG 2.2 AA.
- Observability: structured server logs, error boundary, Sentry optional (ask).
- Testing: unit (extraction parsing, date resolution, quote verification, quiet hours), integration (RLS), e2e (golden path).

## 5. Design direction
Deck is inspiration, **improve it**. See skill `followthrough-design-system` for tokens extracted from the deck (deep green, soft sage, lime accent, warm neutrals) and the improvement brief. Calm, spacious, one primary action per screen.

## 6. Phases (details in docs/BUILD-PLAN.md)
0 Plan & scaffold → 1 Auth + schema + RLS → 2 Capture + manual tasks + dashboard → 3 AI extraction + review → 4 Setup/onboarding + Settings → 5 Google Calendar + Google Tasks → 6 Reminders (Resend) → 7 Wispr import adapter → 8 Hardening, a11y, e2e, deploy.
Stop after each phase, run qa-reviewer and security-reviewer, show the user a demo summary, and wait for approval.

## 7. Definition of done
All phase acceptance tests pass · lint/typecheck/tests green · `.env.example` complete · README with setup (Supabase project, Google Cloud OAuth, Resend domain, Vercel) · seeded demo data script (Maya Chen / Product sync from the deck) · deployed preview URL.

## 8. How to communicate
Short status after each task. Ask a question the moment something is ambiguous — one clear question with options. Never silently pick a default for anything in OPEN-QUESTIONS.
