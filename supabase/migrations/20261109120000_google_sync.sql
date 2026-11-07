-- Phase 5: retries for syncing tasks to Google. Only the server writes these columns;
-- signed-in users can read their own sync state, as before.

alter table public.task_syncs
  add column attempts integer not null default 0 check (attempts >= 0),
  add column next_attempt_at timestamptz,
  -- The Google Tasks list or calendar the item lives in, so it can be found again.
  add column container_id text check (char_length(container_id) <= 1024),
  add constraint task_syncs_external_id_length check (char_length(external_id) <= 1024),
  add constraint task_syncs_last_error_length check (char_length(last_error) <= 500);

create index task_syncs_due_idx on public.task_syncs (next_attempt_at) where state <> 'ok';

-- Google ids are opaque strings; keep them short enough to index and display.
alter table public.integrations
  add constraint integrations_calendar_id_length check (char_length(calendar_id) <= 1024),
  add constraint integrations_tasklist_id_length check (char_length(tasklist_id) <= 1024);
