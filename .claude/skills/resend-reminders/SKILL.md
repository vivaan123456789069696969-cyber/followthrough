---
name: resend-reminders
description: Use when building email reminders (Resend), cron scheduling, quiet hours, digest logic, idempotency and unsubscribe.
---
# Resend Reminders

## Types
1. **Due today** (morning digest at user's `digest_time`).
2. **Due tomorrow** (optional "1 day before", included in the morning digest; tasks have dates only, no due times).
3. **Overdue** (included in the daily digest, for up to 7 days after the due date).
4. Optional "Waiting on others" weekly digest, sent only to the user, off by default.

Snoozed tasks (`snoozed_until` in the future) get no reminders.

## Scheduler
Vercel Cron hits `/api/cron/reminders` every 15 min. Route requires `Authorization: Bearer ${CRON_SECRET}`. It uses the admin Supabase client, loads users with prefs enabled, computes in **each user's timezone**, and sends within the 15-min window. 

## Rules
- **Quiet hours**: never send inside `[quiet_start, quiet_end)` (may wrap midnight); defer to quiet-end instead of dropping.
- **Idempotency**: insert into `reminder_log` with unique `(task_id,user_id,kind,scheduled_for)` *before* sending; on conflict skip. Store Resend id after send; on failure mark and allow retry.
- Skip tasks that are done/dismissed/deleted at send time (re-check).
- Batch into one digest email per user per run (no email storms). Cap per-user daily emails.
- Every email: plain-language subject ("Due today: Send revised launch brief" or "3 things need you today"), context line "From Product sync", button "Open task" (deep link), preferences link, **one-click unsubscribe** (signed token, no login) and `List-Unsubscribe` + `List-Unsubscribe-Post` headers.
- Template: React Email or plain HTML + text alternative; follows design system; renders in dark mode; no tracking pixels by default.
- Domain: SPF/DKIM verified in Resend before production; document steps in README.
- Dev mode: log emails instead of sending unless `RESEND_ENABLED=true`; provide a preview route.

## Tests
Fake clock tests: timezone differences (IST vs PST), DST, quiet-hours wrap, duplicate cron invocation, done-before-send, unsubscribe token validity/expiry.
