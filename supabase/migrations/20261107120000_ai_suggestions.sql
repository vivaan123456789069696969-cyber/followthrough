-- Phase 3: AI suggestions, confirming them into tasks, usage tracking and note limits.

-- ---------------------------------------------------------------------------
-- Usage. Every request to the model first reserves its worst-case cost, under a
-- per-user lock, so parallel requests can't all slip under the limits. After the
-- call the server settles the row to the real figures using a one-time token
-- that only it saw. A failed or timed-out call keeps the worst-case cost.
-- ---------------------------------------------------------------------------

alter table public.ai_usage add column settle_token uuid;

-- Users can read their own usage, but never the token.
revoke select on public.ai_usage from authenticated;
grant select (id, user_id, note_id, model, input_tokens, output_tokens, cost_usd, created_at, updated_at)
  on public.ai_usage to authenticated;

create function public.reserve_ai_usage(
  p_note_id uuid,
  p_model text,
  p_estimate_usd numeric,
  p_monthly_cap_usd numeric,
  p_hourly_limit integer,
  p_global_cap_usd numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  note_workspace uuid;
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  new_id uuid;
  new_token uuid := gen_random_uuid();
begin
  select workspace_id into note_workspace from public.meeting_notes where id = p_note_id;
  if me is null or note_workspace is null or not public.is_member(note_workspace) then
    raise exception 'note not found' using errcode = '42501';
  end if;
  if p_model is null or char_length(p_model) > 100 or p_estimate_usd is null or p_estimate_usd < 0 or p_estimate_usd > 10
    or p_monthly_cap_usd is null or p_hourly_limit is null then
    raise exception 'bad usage values' using errcode = '22023';
  end if;

  -- One reservation at a time per user, so the counts below can't go stale.
  perform pg_advisory_xact_lock(hashtext('ai_usage:' || me::text));

  if (select count(*) from public.ai_usage where user_id = me and created_at > now() - interval '1 hour') >= p_hourly_limit then
    raise exception 'ai_hourly_limit' using errcode = 'P0001';
  end if;
  if (select coalesce(sum(cost_usd), 0) from public.ai_usage where user_id = me and created_at >= month_start) >= p_monthly_cap_usd then
    raise exception 'ai_monthly_cap' using errcode = 'P0001';
  end if;
  if p_global_cap_usd is not null then
    perform pg_advisory_xact_lock(hashtext('ai_usage:all'));
    if (select coalesce(sum(cost_usd), 0) from public.ai_usage where created_at >= month_start) >= p_global_cap_usd then
      raise exception 'ai_global_cap' using errcode = 'P0001';
    end if;
  end if;

  insert into public.ai_usage (user_id, note_id, model, cost_usd, settle_token)
    values (me, p_note_id, p_model, p_estimate_usd, new_token)
    returning id into new_id;
  return jsonb_build_object('id', new_id, 'token', new_token);
end;
$$;

create function public.settle_ai_usage(
  p_usage_id uuid,
  p_token uuid,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_model is null or char_length(p_model) > 100 or p_input_tokens < 0 or p_output_tokens < 0 or p_cost_usd < 0 then
    raise exception 'bad usage values' using errcode = '22023';
  end if;
  update public.ai_usage
    set model = p_model, input_tokens = p_input_tokens, output_tokens = p_output_tokens, cost_usd = p_cost_usd, settle_token = null
    where id = p_usage_id and user_id = (select auth.uid()) and settle_token is not null and settle_token = p_token;
  if not found then
    raise exception 'usage not open' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Adding suggestions. The app checks quotes first; this checks again, inside the
-- database, so nothing can store a suggestion whose words aren't in the notes.
-- Items that fail a check are skipped, and the count added is returned.
-- Offsets count characters (code points), as Postgres does.
--
-- These checks cover what Claude suggests. Afterwards the user may edit the
-- title, owner and date themselves, which is their choice to make.
-- ---------------------------------------------------------------------------

create function public.add_suggestions(p_note_id uuid, p_model text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  note record;
  item jsonb;
  locator jsonb;
  quote text;
  title text;
  owner text;
  basis text;
  due date;
  stamp text;
  line integer;
  questions jsonb;
  span_start integer;
  span_end integer;
  added integer := 0;
begin
  -- Locking the note means two runs on it can't interleave.
  select id, workspace_id, raw_text into note from public.meeting_notes where id = p_note_id for update;
  if note.id is null or not public.is_member(note.workspace_id) then
    raise exception 'note not found' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'too many suggestions' using errcode = '22023';
  end if;
  if p_model is null or char_length(p_model) > 100 then
    raise exception 'bad model name' using errcode = '22023';
  end if;

  -- A new run replaces suggestions nobody has acted on yet.
  delete from public.suggestions where note_id = note.id and status = 'pending';

  for item in select value from jsonb_array_elements(p_items) loop
    begin
      if jsonb_typeof(item) <> 'object' or jsonb_typeof(item -> 'source_locator') <> 'object' then
        continue;
      end if;
      quote := item ->> 'source_quote';
      title := btrim(item ->> 'title');
      owner := nullif(btrim(item ->> 'owner_name'), '');
      basis := nullif(btrim(item ->> 'due_date_basis'), '');
      due := nullif(item ->> 'due_date', '')::date;
      locator := item -> 'source_locator';
      span_start := (locator ->> 'start')::integer;
      span_end := (locator ->> 'end')::integer;
      stamp := locator ->> 'value';
      line := (locator ->> 'line')::integer;
      questions := coalesce(item -> 'open_questions', '[]'::jsonb);

      continue when quote is null or span_start is null or span_end is null or span_start < 0 or span_end <= span_start
        or span_end > char_length(note.raw_text)
        or substr(note.raw_text, span_start + 1, span_end - span_start) <> quote;
      continue when title is null or char_length(title) not between 3 and 140;
      continue when coalesce(item ->> 'confidence', '') not in ('high', 'medium', 'low');
      continue when coalesce(locator ->> 'type', '') not in ('timestamp', 'offset');
      continue when stamp is not null and stamp !~ '^\d{1,2}:\d{2}(:\d{2})?$';
      continue when line is not null and line not between 1 and 1000000;
      -- Owners and dates must come from the notes, as whole words, never from the model's imagination.
      continue when owner is not null and (char_length(owner) > 200 or lower(note.raw_text) !~ (
        '(^|[^[:alnum:]])' || regexp_replace(lower(owner), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '($|[^[:alnum:]])'));
      continue when due is not null and basis is null;
      continue when basis is not null and (char_length(basis) > 200 or lower(note.raw_text) !~ (
        '(^|[^[:alnum:]])' || regexp_replace(lower(basis), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '($|[^[:alnum:]])'));
      -- Words the user already confirmed or dismissed don't come back on a new run.
      continue when exists (
        select 1 from public.suggestions s
        where s.note_id = note.id and s.status <> 'pending'
          and (s.source_locator ->> 'start')::integer < span_end and span_start < (s.source_locator ->> 'end')::integer
      );
      continue when jsonb_typeof(questions) <> 'array' or jsonb_array_length(questions) > 3
        or exists (
          select 1 from jsonb_array_elements(questions) q
          where jsonb_typeof(q) <> 'string' or char_length(q #>> '{}') > 200
        );

      insert into public.suggestions (
        note_id, workspace_id, title, owner_name, due_date, due_date_basis,
        source_quote, source_locator, confidence, open_questions, model
      ) values (
        note.id, note.workspace_id, title, owner, due, basis,
        quote,
        jsonb_build_object('type', locator ->> 'type', 'value', stamp, 'start', span_start, 'end', span_end, 'line', line),
        item ->> 'confidence', questions, p_model
      );
      added := added + 1;
    exception
      -- A value that won't convert (a bad date or number) skips that item only.
      when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
        null;
    end;
  end loop;

  return added;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirming a suggestion. One step that creates the task with the verified
-- quote copied across, so a task's source can never be typed in by hand.
-- ---------------------------------------------------------------------------

create function public.confirm_suggestion(
  p_suggestion_id uuid,
  p_title text,
  p_owner_kind text,
  p_owner_name text,
  p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  suggestion record;
  existing uuid;
  contact uuid;
  owner_user uuid;
  new_task uuid;
  name text := nullif(btrim(p_owner_name), '');
begin
  -- Locked, so two confirms at once both return the one task instead of one failing.
  select s.*, n.meeting_id into suggestion
  from public.suggestions s join public.meeting_notes n on n.id = s.note_id
  where s.id = p_suggestion_id
  for update of s;

  if suggestion.id is null or not public.is_member(suggestion.workspace_id) then
    raise exception 'suggestion not found' using errcode = '42501';
  end if;

  -- Confirming twice returns the same task instead of making another.
  select id into existing from public.tasks where suggestion_id = suggestion.id;
  if existing is not null then
    return existing;
  end if;
  if suggestion.status <> 'pending' then
    raise exception 'suggestion was dismissed' using errcode = '22023';
  end if;

  if p_owner_kind = 'me' then
    owner_user := (select auth.uid());
  elsif p_owner_kind = 'other' then
    if name is null then
      raise exception 'owner name is missing' using errcode = '22023';
    end if;
    select id into contact from public.contacts
      where workspace_id = suggestion.workspace_id and lower(display_name) = lower(name);
    if contact is null then
      insert into public.contacts (workspace_id, display_name) values (suggestion.workspace_id, name)
        on conflict (workspace_id, lower(display_name)) do nothing
        returning id into contact;
      if contact is null then
        select id into contact from public.contacts
          where workspace_id = suggestion.workspace_id and lower(display_name) = lower(name);
      end if;
    end if;
  elsif p_owner_kind <> 'none' then
    raise exception 'unknown owner choice' using errcode = '22023';
  end if;

  insert into public.tasks (
    workspace_id, meeting_id, suggestion_id, title, owner_user_id, owner_contact_id,
    due_date, source_quote, source_locator, created_by
  ) values (
    suggestion.workspace_id, suggestion.meeting_id, suggestion.id, btrim(p_title), owner_user, contact,
    p_due_date, suggestion.source_quote, suggestion.source_locator, (select auth.uid())
  ) returning id into new_task;

  insert into public.task_events (task_id, workspace_id, actor_id, type)
    values (new_task, suggestion.workspace_id, (select auth.uid()), 'created');

  update public.suggestions
    set status = 'confirmed',
      -- The task keeps whatever title the user typed; the suggestion only takes it if it fits its own limits.
      title = case when char_length(btrim(p_title)) between 3 and 140 then btrim(p_title) else title end,
      owner_name = name,
      due_date = p_due_date
    where id = suggestion.id;

  return new_task;
end;
$$;

revoke execute on function
  public.reserve_ai_usage(uuid, text, numeric, numeric, integer, numeric),
  public.settle_ai_usage(uuid, uuid, text, integer, integer, numeric),
  public.add_suggestions(uuid, text, jsonb),
  public.confirm_suggestion(uuid, text, text, text, date)
from public, anon;
grant execute on function
  public.reserve_ai_usage(uuid, text, numeric, numeric, integer, numeric),
  public.settle_ai_usage(uuid, uuid, text, integer, integer, numeric),
  public.add_suggestions(uuid, text, jsonb),
  public.confirm_suggestion(uuid, text, text, text, date)
to authenticated;

-- ---------------------------------------------------------------------------
-- Note limits: storage per workspace and new notes per hour, checked by the
-- database so they hold however notes arrive.
-- ---------------------------------------------------------------------------

create index meeting_notes_workspace_idx on public.meeting_notes (workspace_id);
create index meeting_notes_creator_created_idx on public.meeting_notes (created_by, created_at desc);

create function public.enforce_note_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- One new note at a time per workspace, so parallel inserts can't pass the limits together.
  perform pg_advisory_xact_lock(hashtext('meeting_notes:' || new.workspace_id::text));

  if (
    select count(*) from public.meeting_notes
    where created_by = new.created_by and created_at > now() - interval '1 hour'
  ) >= 60 then
    raise exception 'note_rate_limit' using errcode = 'P0001';
  end if;

  if (
    select coalesce(sum(char_length(raw_text)), 0) from public.meeting_notes where workspace_id = new.workspace_id
  ) + char_length(new.raw_text) > 5000000 then
    raise exception 'note_storage_limit' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger enforce_note_limits
  before insert on public.meeting_notes
  for each row execute function public.enforce_note_limits();
