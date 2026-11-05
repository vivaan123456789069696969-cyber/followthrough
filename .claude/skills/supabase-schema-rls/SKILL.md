---
name: supabase-schema-rls
description: Use when creating or changing Supabase migrations, RLS policies, auth triggers, or typed DB access for FollowThrough.
---
# Supabase Schema & RLS

1. Source of truth: `docs/DATA-MODEL.md`. Changes go through new files in `supabase/migrations/` (timestamp prefix); never edit applied migrations.
2. Every table: `enable row level security`, explicit policies per command, `updated_at` trigger, FK `on delete cascade` where child data is meaningless without parent.
3. Membership helper: `create function is_member(ws uuid) returns boolean language sql security definer stable set search_path=public as $$ select exists(select 1 from workspace_members where workspace_id=ws and user_id=auth.uid()) $$;`
4. Signup trigger on `auth.users` creates profile, personal workspace, owner membership (security definer, fixed search_path).
5. Tokens table: revoke select/insert/update on token columns from `anon` and `authenticated`; access only via server using the service role key, which must never be imported in client bundles (enforce with a lint rule or `server-only`).
6. Generate types: `supabase gen types typescript` → `lib/supabase/types.ts`. Use typed clients: browser client (anon key + user session), server client (cookies), admin client (service role, server-only, used only for cron and token ops).
7. **RLS test suite** (pgTAP or Vitest with two real test users): for each table assert A can CRUD own rows and cannot select/insert/update/delete B's rows, and anon gets nothing.
8. Never use `using (true)`. Never rely on client-supplied `workspace_id` without the `is_member` check in `with check`.
9. Performance: add the indexes listed in DATA-MODEL; check policies with `explain`.
10. Seed script creates Maya Chen demo data (see master prompt) for local/dev only, never prod.
