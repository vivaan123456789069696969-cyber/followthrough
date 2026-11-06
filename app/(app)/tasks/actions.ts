"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/lib/auth/routes";
import { getAppContext, type AppContext } from "@/lib/data/context";
import { isCalendarDate } from "@/lib/tasks/dates";
import type { TaskEventType } from "@/lib/supabase/types";

export type FormState = { error: string | null; values?: Record<string, string> };

const logFailure = (event: string, code?: string) => console.error(JSON.stringify({ event, code: code ?? "unknown" }));

const optionalDate = z
  .string()
  .trim()
  .transform((value) => value || null)
  .refine((value) => value === null || isCalendarDate(value), "Enter a valid date.");

const taskSchema = z
  .object({
    id: z.uuid().or(z.literal("")),
    meeting_id: z.uuid().or(z.literal("")),
    title: z.string().trim().min(1, "Add a task title.").max(300, "Keep the title under 300 characters."),
    description: z.string().trim().max(10000, "Keep the details under 10,000 characters."),
    owner_kind: z.enum(["me", "none", "other"]),
    owner_name: z.string().trim().max(200, "Keep the name under 200 characters."),
    due_date: optionalDate,
  })
  .refine((task) => task.owner_kind !== "other" || task.owner_name.length > 0, "Add the owner's name.");

async function recordEvent({ supabase, workspaceId, userId }: AppContext, taskId: string, type: TaskEventType) {
  const { error } = await supabase.from("task_events").insert({ task_id: taskId, workspace_id: workspaceId, actor_id: userId, type });
  // The task itself saved, so a missing log line shouldn't fail the user's action.
  if (error) logFailure("task_event_failed", error.code);
}

/** Reuses a contact with the same name, so "Sam" and "sam" stay one person. */
async function contactIdFor({ supabase, workspaceId }: AppContext, name: string): Promise<string | null> {
  // An exact, case-insensitive match. Escape the pattern characters so a name can't act as a wildcard.
  const pattern = name.replace(/[\\%_]/g, (character) => `\\${character}`);
  const find = () =>
    supabase.from("contacts").select("id").eq("workspace_id", workspaceId).ilike("display_name", pattern).limit(1).maybeSingle();

  const existing = await find();
  if (existing.data) return existing.data.id;

  const { data, error } = await supabase
    .from("contacts")
    .insert({ workspace_id: workspaceId, display_name: name })
    .select("id")
    .single();
  if (!error) return data.id;

  // Someone saved the same new name at the same moment. The database keeps one; use it.
  if (error.code === "23505") {
    const again = await find();
    if (again.data) return again.data.id;
  }
  logFailure("contact_create_failed", error.code);
  return null;
}

export async function saveTask(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    owner_kind: String(formData.get("owner_kind") ?? "me"),
    owner_name: String(formData.get("owner_name") ?? ""),
    due_date: String(formData.get("due_date") ?? ""),
  };
  // Returned with every error, so the form keeps what was typed.
  const fail = (error: string): FormState => ({ error, values });

  const parsed = taskSchema.safeParse({ id: formData.get("id") ?? "", meeting_id: formData.get("meeting_id") ?? "", ...values });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // A bad meeting link is our problem, not the user's, so don't show a technical message.
    return fail(issue?.path[0] === "meeting_id" ? "We couldn't find that meeting." : (issue?.message ?? "Check the details and try again."));
  }

  const context = await getAppContext();
  const { supabase, workspaceId, userId } = context;
  const task = parsed.data;

  if (task.id) {
    // Make sure the task is the user's before creating anything for it.
    const { data: own } = await supabase.from("tasks").select("id").eq("id", task.id).maybeSingle();
    if (!own) return fail("We couldn't find this task.");
  }

  let ownerContactId: string | null = null;
  if (task.owner_kind === "other") {
    ownerContactId = await contactIdFor(context, task.owner_name);
    if (!ownerContactId) return fail("We couldn't save the owner. Try again.");
  }
  const fields = {
    title: task.title,
    description: task.description || null,
    owner_user_id: task.owner_kind === "me" ? userId : null,
    owner_contact_id: ownerContactId,
    due_date: task.due_date,
  };

  if (task.id) {
    const { data, error } = await supabase.from("tasks").update(fields).eq("id", task.id).select("id").maybeSingle();
    if (error || !data) {
      logFailure("task_update_failed", error?.code);
      return fail("We couldn't save this task. Try again.");
    }
    await recordEvent(context, task.id, "edited");
  } else {
    const { data, error } = await supabase
      .from("tasks")
      .insert({ ...fields, workspace_id: workspaceId, meeting_id: task.meeting_id || null, created_by: userId })
      .select("id")
      .single();
    if (error) {
      logFailure("task_create_failed", error.code);
      return fail("We couldn't save this task. Try again.");
    }
    await recordEvent(context, data.id, "created");
  }

  revalidatePath("/", "layout");
  redirect(safeNextPath(String(formData.get("return_to") ?? "")));
}

export async function setTaskDone(formData: FormData) {
  const id = z.uuid().parse(formData.get("id"));
  const done = formData.get("done") === "true";
  const context = await getAppContext();

  const { data, error } = await context.supabase
    .from("tasks")
    .update({ status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    logFailure("task_status_failed", error?.code);
    throw new Error("Could not update task");
  }
  await recordEvent(context, id, done ? "done" : "reopened");

  revalidatePath("/", "layout");
  redirect(safeNextPath(String(formData.get("return_to") ?? "")));
}

export async function snoozeTask(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = z.uuid().safeParse(formData.get("id"));
  const until = optionalDate.safeParse(formData.get("snoozed_until") ?? "");
  if (!id.success || !until.success) return { error: "Enter a valid date." };

  const context = await getAppContext();
  if (until.data && until.data <= context.today) return { error: "Choose a date after today." };

  const { data, error } = await context.supabase
    .from("tasks")
    .update({ snoozed_until: until.data })
    .eq("id", id.data)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    logFailure("task_snooze_failed", error?.code);
    return { error: "We couldn't snooze this task. Try again." };
  }
  await recordEvent(context, id.data, "snoozed");

  revalidatePath("/", "layout");
  redirect(safeNextPath(String(formData.get("return_to") ?? "")));
}
