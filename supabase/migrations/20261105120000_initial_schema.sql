-- FollowThrough initial schema. Source of truth: docs/DATA-MODEL.md
--
-- Access model:
--   * RLS on every table. Workspace-scoped rows need membership of that workspace.
--   * Column grants limit what clients can write. Rows the app must vouch for
--     (suggestions, usage, sync state, tokens) are written by the server only.
--   * Composite foreign keys stop a row in one workspace pointing at another
--     workspace's rows, which RLS alone would not catch.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  timezone text, -- null until detected from the browser at first sign-in
  onboarding_done boolean not null default false,
  note_retention_days integer check (note_retention_days > 0), -- null = keep
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null default 'personal' check (kind in ('personal', 'team')),
  -- Deleting an account deletes the workspaces it created and all their data.
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 200),
  email text,
  linked_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index contacts_workspace_id_idx on public.contacts (workspace_id);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  starts_at timestamptz not null,
  source text not null default 'manual' check (source in ('manual', 'google_calendar', 'wispr_import')),
  external_event_id text,
  attendees jsonb not null default '[]'::jsonb check (jsonb_typeof(attendees) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index meetings_workspace_starts_at_idx on public.meetings (workspace_id, starts_at desc);
-- One meeting per calendar event, so an event can't be imported twice.
create unique index meetings_workspace_external_event_idx
  on public.meetings (workspace_id, external_event_id)
  where external_event_id is not null;

create table public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null,
  workspace_id uuid not null,
  raw_text text not null check (char_length(raw_text) <= 100000),
  source_format text not null check (source_format in ('paste', 'txt', 'md', 'vtt', 'srt', 'docx', 'wispr_import')),
  has_timestamps boolean not null default false,
  content_hash text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade
);

create index meeting_notes_meeting_id_idx on public.meeting_notes (meeting_id);

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  workspace_id uuid not null,
  title text not null check (char_length(title) between 3 and 140),
  owner_name text,
  owner_contact_id uuid,
  due_date date,
  due_date_basis text,
  source_quote text not null,
  source_locator jsonb not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  open_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(open_questions) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (note_id, workspace_id) references public.meeting_notes (id, workspace_id) on delete cascade,
  foreign key (owner_contact_id, workspace_id) references public.contacts (id, workspace_id) on delete set null (owner_contact_id)
);

create index suggestions_note_status_idx on public.suggestions (note_id, status);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid,
  suggestion_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  owner_user_id uuid,
  owner_contact_id uuid,
  due_date date,
  snoozed_until date,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  source_quote text,
  source_locator jsonb,
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (owner_user_id is null or owner_contact_id is null),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete set null (meeting_id),
  foreign key (suggestion_id, workspace_id) references public.suggestions (id, workspace_id) on delete set null (suggestion_id),
  -- An owning user must be a member of the task's workspace.
  foreign key (workspace_id, owner_user_id) references public.workspace_members (workspace_id, user_id) on delete set null (owner_user_id),
  foreign key (owner_contact_id, workspace_id) references public.contacts (id, workspace_id) on delete set null (owner_contact_id)
);

create index tasks_workspace_status_due_idx on public.tasks (workspace_id, status, due_date);
create index tasks_owner_status_due_idx on public.tasks (owner_user_id, status, due_date);
create index tasks_meeting_id_idx on public.tasks (meeting_id);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  workspace_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  type text not null check (type in ('created', 'edited', 'done', 'reopened', 'snoozed', 'synced', 'reminded')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade
);

create index task_events_task_id_idx on public.task_events (task_id, created_at desc);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  provider text not null check (provider in ('google')),
  scopes text[] not null default '{}',
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'needs_reconnect', 'revoked')),
  calendar_id text,
  tasklist_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider),
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);

create table public.task_syncs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  workspace_id uuid not null,
  provider text not null check (provider in ('google_tasks', 'google_calendar')),
  external_id text,
  state text not null default 'pending' check (state in ('pending', 'ok', 'failed')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, provider),
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade
);

create index task_syncs_state_idx on public.task_syncs (state) where state <> 'ok';

create table public.reminder_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  digest_time time,
  day_before boolean not null default false,
  quiet_start time,
  quiet_end time,
  types jsonb not null default '{}'::jsonb,
  unsubscribe_token text not null unique default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  resend_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, user_id, kind, scheduled_for)
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Usage outlives a deleted note, so deleting notes can't reset the monthly cap.
  note_id uuid references public.meeting_notes (id) on delete set null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(10, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.workspace_members for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.contacts for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.meetings for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.meeting_notes for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.suggestions for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.task_events for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.integrations for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.task_syncs for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.reminder_prefs for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.reminder_log for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.ai_usage for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Original notes can't change: source quotes point into them.
-- ---------------------------------------------------------------------------

create function public.prevent_raw_text_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.raw_text is distinct from old.raw_text then
    raise exception 'meeting_notes.raw_text is immutable';
  end if;
  return new;
end;
$$;

create trigger prevent_raw_text_change
  before update on public.meeting_notes
  for each row execute function public.prevent_raw_text_change();

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so policies on workspace_members don't recurse.
-- ---------------------------------------------------------------------------

create function public.is_member(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid())
  );
$$;

create function public.is_workspace_owner(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Signup: profile, personal workspace, owner membership
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  insert into public.workspaces (name, kind, created_by)
  values ('Personal', 'personal', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.contacts enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_notes enable row level security;
alter table public.suggestions enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.integrations enable row level security;
alter table public.task_syncs enable row level security;
alter table public.reminder_prefs enable row level security;
alter table public.reminder_log enable row level security;
alter table public.ai_usage enable row level security;

create policy "profiles_select_self" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "workspaces_select_member" on public.workspaces for select to authenticated
  using (public.is_member(id));
create policy "workspaces_update_owner" on public.workspaces for update to authenticated
  using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));

create policy "workspace_members_select_member" on public.workspace_members for select to authenticated
  using (public.is_member(workspace_id));

create policy "contacts_select_member" on public.contacts for select to authenticated
  using (public.is_member(workspace_id));
create policy "contacts_insert_member" on public.contacts for insert to authenticated
  with check (public.is_member(workspace_id));
create policy "contacts_update_member" on public.contacts for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "contacts_delete_member" on public.contacts for delete to authenticated
  using (public.is_member(workspace_id));

create policy "meetings_select_member" on public.meetings for select to authenticated
  using (public.is_member(workspace_id));
create policy "meetings_insert_member" on public.meetings for insert to authenticated
  with check (public.is_member(workspace_id));
create policy "meetings_update_member" on public.meetings for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "meetings_delete_member" on public.meetings for delete to authenticated
  using (public.is_member(workspace_id));

create policy "meeting_notes_select_member" on public.meeting_notes for select to authenticated
  using (public.is_member(workspace_id));
create policy "meeting_notes_insert_member" on public.meeting_notes for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));
create policy "meeting_notes_delete_member" on public.meeting_notes for delete to authenticated
  using (public.is_member(workspace_id));

create policy "suggestions_select_member" on public.suggestions for select to authenticated
  using (public.is_member(workspace_id));
create policy "suggestions_update_member" on public.suggestions for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "suggestions_delete_member" on public.suggestions for delete to authenticated
  using (public.is_member(workspace_id));

create policy "tasks_select_member" on public.tasks for select to authenticated
  using (public.is_member(workspace_id));
create policy "tasks_insert_member" on public.tasks for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));
create policy "tasks_update_member" on public.tasks for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "tasks_delete_member" on public.tasks for delete to authenticated
  using (public.is_member(workspace_id));

create policy "task_events_select_member" on public.task_events for select to authenticated
  using (public.is_member(workspace_id));
create policy "task_events_insert_member" on public.task_events for insert to authenticated
  with check (public.is_member(workspace_id) and actor_id = (select auth.uid()));

create policy "integrations_select_self" on public.integrations for select to authenticated
  using (user_id = (select auth.uid()));

create policy "task_syncs_select_member" on public.task_syncs for select to authenticated
  using (public.is_member(workspace_id));

create policy "reminder_prefs_select_self" on public.reminder_prefs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "reminder_prefs_insert_self" on public.reminder_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "reminder_prefs_update_self" on public.reminder_prefs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "reminder_log_select_self" on public.reminder_log for select to authenticated
  using (user_id = (select auth.uid()));

create policy "ai_usage_select_self" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants. Start from nothing, then allow only what the app needs.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, timezone, onboarding_done, note_retention_days) on public.profiles to authenticated;

grant select on public.workspaces to authenticated;
grant update (name) on public.workspaces to authenticated;

grant select on public.workspace_members to authenticated;

-- linked_user_id stays server-only until team features exist.
grant select, delete on public.contacts to authenticated;
grant insert (workspace_id, display_name, email) on public.contacts to authenticated;
grant update (display_name, email) on public.contacts to authenticated;

grant select, delete on public.meetings to authenticated;
grant insert (workspace_id, title, starts_at, source, external_event_id, attendees) on public.meetings to authenticated;
grant update (title, starts_at, attendees) on public.meetings to authenticated;

-- Notes are insert-and-delete only for clients.
grant select, delete on public.meeting_notes to authenticated;
grant insert (meeting_id, workspace_id, raw_text, source_format, has_timestamps, content_hash, created_by) on public.meeting_notes to authenticated;

-- Suggestions are created by the server after it verifies the quote against the notes.
grant select, delete on public.suggestions to authenticated;
grant update (title, owner_name, owner_contact_id, due_date, status) on public.suggestions to authenticated;

grant select, delete on public.tasks to authenticated;
grant insert (workspace_id, meeting_id, suggestion_id, title, description, owner_user_id, owner_contact_id, due_date, snoozed_until, status, source_quote, source_locator, completed_at, created_by) on public.tasks to authenticated;
grant update (title, description, owner_user_id, owner_contact_id, due_date, snoozed_until, status, completed_at) on public.tasks to authenticated;

-- The activity log is append-only for clients.
grant select on public.task_events to authenticated;
grant insert (task_id, workspace_id, actor_id, type, payload) on public.task_events to authenticated;

-- No token columns here: clients can never read them.
grant select (id, workspace_id, user_id, provider, scopes, expires_at, status, calendar_id, tasklist_id, created_at, updated_at) on public.integrations to authenticated;

grant select on public.task_syncs to authenticated;

grant select (id, user_id, enabled, digest_time, day_before, quiet_start, quiet_end, types, created_at, updated_at) on public.reminder_prefs to authenticated;
grant insert (user_id, enabled, digest_time, day_before, quiet_start, quiet_end, types) on public.reminder_prefs to authenticated;
grant update (enabled, digest_time, day_before, quiet_start, quiet_end, types) on public.reminder_prefs to authenticated;

grant select on public.reminder_log to authenticated;

grant select on public.ai_usage to authenticated;
