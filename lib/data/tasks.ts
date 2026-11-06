import "server-only";
import type { TaskStatus } from "@/lib/supabase/types";
import type { AppContext } from "./context";

const TASK_COLUMNS =
  "id, title, description, meeting_id, owner_user_id, owner_contact_id, due_date, snoozed_until, status, source_quote, completed_at, created_at";

/** Long id lists go in batches, so the request URL stays under server limits. */
const BATCH = 100;

async function namesById(
  context: AppContext,
  table: "contacts" | "meetings",
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let start = 0; start < ids.length; start += BATCH) {
    const batch = ids.slice(start, start + BATCH);
    if (table === "contacts") {
      const { data, error } = await context.supabase.from("contacts").select("id, display_name").in("id", batch);
      if (error) throw new Error("Could not load task details");
      data.forEach((row) => names.set(row.id, row.display_name));
    } else {
      const { data, error } = await context.supabase.from("meetings").select("id, title").in("id", batch);
      if (error) throw new Error("Could not load task details");
      data.forEach((row) => names.set(row.id, row.title));
    }
  }
  return names;
}

export async function listContacts({ supabase, workspaceId }: AppContext) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, display_name")
    .eq("workspace_id", workspaceId)
    .order("display_name")
    .limit(500);
  if (error) throw new Error("Could not load contacts");
  return data;
}

/**
 * Tasks with the names people read: the owner and the meeting they came from.
 * Open tasks are what the dashboard counts, so they're fetched by status rather than
 * mixed in with finished ones, which would push open tasks out of the limit.
 */
export async function listTasks(context: AppContext, filter: { meetingId?: string; status?: TaskStatus } = {}) {
  const { supabase, workspaceId } = context;

  let query = supabase.from("tasks").select(TASK_COLUMNS).eq("workspace_id", workspaceId);
  if (filter.meetingId) query = query.eq("meeting_id", filter.meetingId);
  if (filter.status) query = query.eq("status", filter.status);
  const { data: tasks, error } = await query
    .order(filter.status === "done" ? "completed_at" : "created_at", { ascending: filter.status !== "done" })
    .limit(1000);
  if (error) throw new Error("Could not load tasks");

  const contactIds = [...new Set(tasks.flatMap((task) => task.owner_contact_id ?? []))];
  const meetingIds = [...new Set(tasks.flatMap((task) => task.meeting_id ?? []))];
  const [contactName, meetingTitle] = await Promise.all([
    namesById(context, "contacts", contactIds),
    namesById(context, "meetings", meetingIds),
  ]);

  return tasks.map((task) => ({
    ...task,
    owner_name: task.owner_contact_id ? (contactName.get(task.owner_contact_id) ?? null) : null,
    meeting_title: task.meeting_id ? (meetingTitle.get(task.meeting_id) ?? null) : null,
  }));
}

export type TaskRowData = Awaited<ReturnType<typeof listTasks>>[number];

export async function getTask(context: AppContext, id: string) {
  const { supabase } = context;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
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
