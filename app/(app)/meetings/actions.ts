"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/lib/data/context";
import { parseNoteFile, validateNoteText, type ParsedNote } from "@/lib/notes/parse";
import { localToUtc } from "@/lib/tasks/dates";
import type { NoteFormat } from "@/lib/supabase/types";

export type MeetingFormState = { error: string | null };
export type NotesFormState = { error: string | null; text: string };

const logFailure = (event: string, code?: string) => console.error(JSON.stringify({ event, code: code ?? "unknown" }));

const meetingSchema = z.object({
  id: z.uuid().or(z.literal("")),
  title: z.string().trim().min(1, "Add a meeting title.").max(300, "Keep the title under 300 characters."),
  starts_at: z.string().min(1, "Add the date and time."),
  attendees: z.string().max(5000, "That's too many attendees."),
});

export async function saveMeeting(_previous: MeetingFormState, formData: FormData): Promise<MeetingFormState> {
  const parsed = meetingSchema.safeParse({
    id: formData.get("id") ?? "",
    title: formData.get("title") ?? "",
    starts_at: formData.get("starts_at") ?? "",
    attendees: formData.get("attendees") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };

  const { supabase, workspaceId, timezone } = await getAppContext();
  const startsAt = localToUtc(parsed.data.starts_at, timezone);
  if (!startsAt) return { error: "Enter a valid date and time." };

  const fields = {
    title: parsed.data.title,
    starts_at: startsAt.toISOString(),
    attendees: parsed.data.attendees
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 200),
  };

  let meetingId = parsed.data.id;
  if (meetingId) {
    const { data, error } = await supabase.from("meetings").update(fields).eq("id", meetingId).select("id").maybeSingle();
    if (error || !data) {
      logFailure("meeting_update_failed", error?.code);
      return { error: "We couldn't save this meeting. Try again." };
    }
  } else {
    const { data, error } = await supabase
      .from("meetings")
      .insert({ ...fields, workspace_id: workspaceId })
      .select("id")
      .single();
    if (error) {
      logFailure("meeting_create_failed", error.code);
      return { error: "We couldn't save this meeting. Try again." };
    }
    meetingId = data.id;
  }

  revalidatePath("/", "layout");
  redirect(`/meetings/${meetingId}`);
}

export async function deleteMeeting(formData: FormData) {
  const id = z.uuid().parse(formData.get("id"));
  const { supabase } = await getAppContext();
  const { error } = await supabase.from("meetings").delete().eq("id", id);
  if (error) {
    logFailure("meeting_delete_failed", error.code);
    throw new Error("Could not delete meeting");
  }
  revalidatePath("/", "layout");
  redirect("/meetings");
}

export async function addNotes(_previous: NotesFormState, formData: FormData): Promise<NotesFormState> {
  const pasted = String(formData.get("text") ?? "");
  const meetingId = z.uuid().safeParse(formData.get("meeting_id"));
  if (!meetingId.success) return { error: "We couldn't find this meeting.", text: pasted };

  const file = formData.get("file");
  // An empty file box still sends a nameless, zero-byte file, so only a non-empty one counts.
  const hasFile = file instanceof File && file.size > 0;

  let parsed: ParsedNote & { format?: NoteFormat };
  if (hasFile) {
    parsed = await parseNoteFile(file.name, await file.arrayBuffer());
  } else {
    parsed = { ...validateNoteText(pasted), format: "paste" };
  }
  if (!parsed.ok) return { error: parsed.message, text: pasted };

  const { supabase, workspaceId, userId } = await getAppContext();
  const { error } = await supabase.from("meeting_notes").insert({
    meeting_id: meetingId.data,
    workspace_id: workspaceId,
    raw_text: parsed.text,
    source_format: parsed.format ?? "paste",
    has_timestamps: parsed.hasTimestamps,
    created_by: userId,
  });
  if (error) {
    logFailure("notes_create_failed", error.code);
    return { error: "We couldn't save these notes. Try again.", text: pasted };
  }

  revalidatePath(`/meetings/${meetingId.data}`);
  return { error: null, text: "" };
}

export async function deleteNotes(formData: FormData) {
  const id = z.uuid().parse(formData.get("id"));
  const meetingId = z.uuid().parse(formData.get("meeting_id"));
  const { supabase } = await getAppContext();
  const { error } = await supabase.from("meeting_notes").delete().eq("id", id);
  if (error) {
    logFailure("notes_delete_failed", error.code);
    throw new Error("Could not delete notes");
  }
  revalidatePath(`/meetings/${meetingId}`);
}
