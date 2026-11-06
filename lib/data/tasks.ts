import "server-only";
import type { AppContext } from "./context";

const TASK_COLUMNS =
  "id, title, description, meeting_id, owner_user_id, owner_contact_id, due_date, snoozed_until, status, source_quote, completed_at, created_at";

export async function listContacts({ supabase, workspaceId }: AppContext) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, display_name")
    .eq("workspace_id", workspaceId)
    .order("display_name");
  if (error) throw new Error("Could not load contacts");
  return data;
}

/** Tasks with the names people read: the owner and the meeting they came from. */
export async function listTasks(context: AppContext, filter: { meetingId?: string } = {}) {
  const { supabase, workspaceId } = context;

  let query = supabase.from("tasks").select(TASK_COLUMNS).eq("workspace_id", workspaceId);
  if (filter.meetingId) query = query.eq("meeting_id", filter.meetingId);
  const { data: tasks, error } = await query.order("created_at").limit(1000);
  if (error) throw new Error("Could not load tasks");

  const contactIds = [...new Set(tasks.flatMap((task) => task.owner_contact_id ?? []))];
  const meetingIds = [...new Set(tasks.flatMap((task) => task.meeting_id ?? []))];

  const [contacts, meetings] = await Promise.all([
    contactIds.length ? supabase.from("contacts").select("id, display_name").in("id", contactIds) : { data: [], error: null },
    meetingIds.length ? supabase.from("meetings").select("id, title").in("id", meetingIds) : { data: [], error: null },
  ]);
  if (contacts.error || meetings.error) throw new Error("Could not load task details");

  const contactName = new Map(contacts.data?.map((contact) => [contact.id, contact.display_name]));
  const meetingTitle = new Map(meetings.data?.map((meeting) => [meeting.id, meeting.title]));

  return tasks.map((task) => ({
    ...task,
    owner_name: task.owner_contact_id ? (contactName.get(task.owner_contact_id) ?? null) : null,
    meeting_title: task.meeting_id ? (meetingTitle.get(task.meeting_id) ?? null) : null,
  }));
}

export type TaskRowData = Awaited<ReturnType<typeof listTasks>>[number];

export async function getTask(context: AppContext, id: string) {
  const { supabase } = context;
  const { data: task, error } = await supabase.from("tasks").select(TASK_COLUMNS).eq("id", id).maybeSingle();
  if (error || !task) return null;

  const [contact, meeting, events] = await Promise.all([
    task.owner_contact_id
      ? supabase.from("contacts").select("display_name").eq("id", task.owner_contact_id).maybeSingle()
      : { data: null },
    task.meeting_id ? supabase.from("meetings").select("title").eq("id", task.meeting_id).maybeSingle() : { data: null },
    supabase.from("task_events").select("id, type, created_at").eq("task_id", id).order("created_at", { ascending: false }).limit(50),
  ]);

  return {
    ...task,
    owner_name: contact.data?.display_name ?? null,
    meeting_title: meeting.data?.title ?? null,
    events: events.data ?? [],
  };
}
