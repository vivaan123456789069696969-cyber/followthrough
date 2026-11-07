import "server-only";
import { z } from "zod";
import type { AppContext } from "./context";

export async function getNote({ supabase }: AppContext, noteId: string) {
  if (!z.uuid().safeParse(noteId).success) return null;
  const { data, error } = await supabase
    .from("meeting_notes")
    .select("id, meeting_id, raw_text, source_format, has_timestamps")
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw new Error("Could not load notes");
  return data;
}

export async function listSuggestions({ supabase }: AppContext, noteId: string) {
  const { data, error } = await supabase
    .from("suggestions")
    .select("id, title, owner_name, due_date, due_date_basis, source_quote, source_locator, confidence, open_questions, status")
    .eq("note_id", noteId)
    .order("created_at")
    .limit(500);
  if (error) throw new Error("Could not load suggestions");
  return [...data].sort((a, b) => a.source_locator.start - b.source_locator.start);
}

export type SuggestionData = Awaited<ReturnType<typeof listSuggestions>>[number];

/** Pending suggestions per note, for the "Review suggestions" links on a meeting. */
export async function pendingCounts({ supabase }: AppContext, noteIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!noteIds.length) return counts;
  const { data } = await supabase.from("suggestions").select("note_id").in("note_id", noteIds).eq("status", "pending");
  (data ?? []).forEach((row) => counts.set(row.note_id, (counts.get(row.note_id) ?? 0) + 1));
  return counts;
}

/** True when a suggested owner looks like the signed-in user. */
export function looksLikeMe(ownerName: string | null, fullName: string | null | undefined): boolean {
  if (!ownerName || !fullName) return false;
  const owner = ownerName.trim().toLowerCase();
  const full = fullName.trim().toLowerCase();
  return owner === full || owner === full.split(/\s+/)[0];
}
