import "server-only";
import { z } from "zod";
import type { AppContext } from "./context";

export async function listMeetings({ supabase, workspaceId }: AppContext) {
  const { data, error } = await supabase
    .from("meetings")
    .select("id, title, starts_at, attendees")
    .eq("workspace_id", workspaceId)
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) throw new Error("Could not load meetings");
  return data;
}

/** Null for a missing meeting, including a malformed id, so the page shows "not found". */
export async function getMeeting({ supabase }: AppContext, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await supabase.from("meetings").select("id, title, starts_at, attendees").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load meeting");
  return data;
}

export async function listNotes({ supabase }: AppContext, meetingId: string) {
  const { data, error } = await supabase
    .from("meeting_notes")
    .select("id, raw_text, source_format, has_timestamps, created_at")
    .eq("meeting_id", meetingId)
    .order("created_at");
  if (error) throw new Error("Could not load notes");
  return data;
}
