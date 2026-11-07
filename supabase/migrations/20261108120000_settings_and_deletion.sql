-- Phase 4: setup choices, deleting an account, and deleting old notes on a schedule.

-- ---------------------------------------------------------------------------
-- Where confirmed tasks should go. Null means "choose later".
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column task_destination text check (task_destination in ('app', 'google_tasks'));

-- Keeping notes for more than ten years is the same as keeping them.
alter table public.profiles
  add constraint profiles_note_retention_days_max check (note_retention_days <= 3650);

grant update (task_destination) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- AI usage outlives the account, with the person removed. Otherwise deleting an
-- account and signing up again would reset the spending limits, and real spend
-- would drop out of the shared monthly total.
-- ---------------------------------------------------------------------------

alter table public.ai_usage alter column user_id drop not null;
alter table public.ai_usage drop constraint ai_usage_user_id_fkey;
alter table public.ai_usage
  add constraint ai_usage_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Deleting an account. Removing the sign-in record removes everything the user
-- owns through cascades: profile, personal workspace and all its meetings, notes,
-- suggestions, tasks and contacts, reminder settings, integrations and usage.
-- ---------------------------------------------------------------------------

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- A shared workspace would be deleted with its creator, taking other people's
  -- work with it. Not possible today; this keeps it from shipping unnoticed.
  if exists (
    select 1 from public.workspaces w
    where w.created_by = me and w.kind <> 'personal'
      and exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id <> me)
  ) then
    raise exception 'transfer_ownership_first' using errcode = 'P0001';
  end if;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Auto-delete. Notes older than the creator's chosen number of days are deleted.
-- Tasks made from them keep their quote, so commitments keep their source.
-- Run daily by pg_cron where it exists. Nobody else can call it.
-- ---------------------------------------------------------------------------

create function public.purge_expired_notes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  -- Personal workspaces only: in a shared one, one person's setting mustn't delete
  -- notes everyone relies on. Shared workspaces will need their own setting.
  delete from public.meeting_notes n
    using public.profiles p, public.workspaces w
    where n.created_by = p.id
      and w.id = n.workspace_id
      and w.kind = 'personal'
      and p.note_retention_days is not null
      and n.created_at < now() - make_interval(days => p.note_retention_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.purge_expired_notes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-expired-notes', '17 3 * * *', 'select public.purge_expired_notes()');
  else
    -- Without a schedule, the promise in Settings would quietly not be kept.
    raise warning 'pg_cron unavailable: purge_expired_notes is not scheduled';
  end if;
end;
$$;
