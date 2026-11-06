-- From the Phase 2 reviews.

-- A meeting's source and calendar event id are set by the server when importing from
-- Google Calendar (Phase 5), never by a client.
revoke insert (source, external_event_id) on public.meetings from authenticated;

-- The activity log's payload is written by the server only.
revoke insert (payload) on public.task_events from authenticated;

-- One contact per name in a workspace, ignoring case, so saving the same new name twice
-- at once can't create two people.
create unique index contacts_workspace_name_idx on public.contacts (workspace_id, lower(display_name));
