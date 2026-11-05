# Data Model (Supabase / Postgres) — team-ready, single-user UI

All tables: `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at` (trigger). **RLS enabled on all.** Access = user is a member of the row's workspace.

| Table | Key columns |
|---|---|
| `profiles` | id (= auth.users.id), full_name, avatar_url, timezone, onboarding_done, note_retention_days? (null = keep) |
| `workspaces` | name, kind (`personal`/`team`), created_by |
| `workspace_members` | workspace_id, user_id, role (`owner`/`admin`/`member`) — unique(workspace_id,user_id) |
| `contacts` | workspace_id, display_name, email?, linked_user_id? (people who can own tasks without an account) |
| `meetings` | workspace_id, title, starts_at, source (`manual`/`google_calendar`/`wispr_import`), external_event_id?, attendees jsonb |
| `meeting_notes` | meeting_id, workspace_id, raw_text (immutable), source_format, has_timestamps, content_hash, created_by |
| `suggestions` | note_id, workspace_id, title, owner_name?, owner_contact_id?, due_date? (`date`), due_date_basis?, source_quote, source_locator jsonb (`{type:'timestamp'|'offset', value, start, end}`), confidence, open_questions jsonb, status (`pending`/`confirmed`/`dismissed`), model, created_at |
| `tasks` | workspace_id, meeting_id?, suggestion_id?, title, description?, owner_user_id?, owner_contact_id?, due_date? (`date`, no time), snoozed_until? (`date`), status (`open`/`done`/`dismissed`), source_quote?, source_locator?, completed_at?, created_by |
| `task_events` | task_id, actor_id, type (`created`/`edited`/`done`/`reopened`/`snoozed`/`synced`/`reminded`), payload jsonb |
| `integrations` | workspace_id, user_id, provider (`google`), scopes[], access_token_enc, refresh_token_enc, expires_at, status, calendar_id?, tasklist_id? |
| `task_syncs` | task_id, provider (`google_tasks`/`google_calendar`), external_id, state (`pending`/`ok`/`failed`), last_error, last_synced_at |
| `reminder_prefs` | user_id, enabled, digest_time, day_before (boolean), quiet_start, quiet_end, types jsonb, unsubscribe_token |
| `reminder_log` | task_id, user_id, kind, scheduled_for, sent_at, resend_id — unique(task_id,user_id,kind,scheduled_for) for idempotency |
| `ai_usage` | user_id, note_id, model, input_tokens, output_tokens, cost_usd numeric, created_at |

## RLS rules
- Helper `is_member(workspace_id)` SECURITY DEFINER, stable.
- SELECT/INSERT/UPDATE/DELETE on workspace-scoped tables require `is_member(workspace_id)`.
- `integrations`, `reminder_prefs`: owner-only (`user_id = auth.uid()`); token columns never selectable by client roles (use server service role only, or column privileges revoked).
- `profiles`: self only.
- Trigger on `auth.users` insert → create profile + personal workspace + owner membership.
- Tests: user A cannot read/write any of user B's rows in every table (automated).

## Indexes
tasks(workspace_id,status,due_date), tasks(owner_user_id,status,due_date), suggestions(note_id,status), reminder_log unique key, meetings(workspace_id,starts_at desc).
