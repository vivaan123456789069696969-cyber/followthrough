---
name: google-integrations
description: Use when implementing Google OAuth, Google Calendar (read meetings, write deadlines) or Google Tasks sync for FollowThrough.
---
# Google Integrations

## OAuth design
- Sign-in with Google (Supabase Auth) requests **only** basic profile/email. Calendar and Tasks are connected later through a **separate, incremental** flow ("Connect calendar") so users can skip them.
- Own OAuth route (`/api/google/connect` → Google → `/api/google/callback`) with `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, signed `state` + PKCE, state bound to the session.
- Scopes (request minimum): `calendar.readonly` for reading meetings; the `calendar` scope for a dedicated "FollowThrough" calendar that holds deadlines; `tasks` for Google Tasks. Request each only when its feature is enabled. Verify current scope names in Google docs before coding; do not rely on memory.
- Tokens: encrypt refresh/access tokens with AES-256-GCM (`lib/crypto`, key `TOKEN_ENC_KEY`, random IV per record), store in `integrations`, server-only. Refresh transparently; on `invalid_grant` mark integration `needs_reconnect` and show a banner.
- Disconnect: call Google revoke endpoint, delete tokens, keep user data, stop syncs.
- Google app is in **Testing** mode until verification; explain this to the user and add test users.

## Calendar read
List events in a window (default past 14 days / next 14 days), show title/time/attendees, button "Create meeting from this event" (stores `external_event_id` to prevent duplicates). Use `syncToken` or time-window queries; handle pagination and rate limits with exponential backoff.

## Calendar write (deadlines)
On task confirm/edit with due date → create/update an **all-day** event titled `Due: {task title}` with description containing deep link; store `external_id` in `task_syncs`. Update on edit; delete the event when the task is done, dismissed or deleted. Idempotent: use extendedProperties `followthrough_task_id` to find existing events.

## Google Tasks
On confirm → insert into chosen task list (user picks list in Settings; default "FollowThrough" list created on first use after asking). Map: title, notes (source quote + link), due (date). Status `done` in app → complete in Google; task deleted in app → delete in Google. Push-only: changes in Google are not read back. Persist sync state, show badge (Synced / Pending / Failed + retry).

## Reliability
Queue-like retry table (`task_syncs.state`) processed by cron + on-demand; max attempts with backoff; never block the UI on Google calls; user-visible errors in plain words.

## Tests
Mock Google with MSW; cover token refresh, revoked token, 429, duplicate prevention, timezone all-day dates, disconnect.
