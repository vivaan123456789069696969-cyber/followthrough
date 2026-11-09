"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { aiConfigured, aiModel, extractActions, globalCapUsd, hourlyLimit, monthlyCapUsd } from "@/lib/ai/extract";
import { checkModelActions } from "@/lib/ai/postprocess";
import { costUsd, worstCaseCostUsd } from "@/lib/ai/prompt";
import { getAppContext } from "@/lib/data/context";
import { syncAfterResponse } from "@/lib/google/schedule";
import { getMeeting } from "@/lib/data/meetings";
import { getNote, looksLikeMe } from "@/lib/data/suggestions";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCalendarDate, longDate, todayInZone } from "@/lib/tasks/dates";

export type ActionState = { error: string | null };

const logFailure = (event: string, code?: string) => console.error(JSON.stringify({ event, code: code ?? "unknown" }));

const FAILURE_MESSAGES = {
  refused: "Claude couldn't work with these notes. You can still add actions yourself.",
  too_long: "These notes were too long to finish. Try splitting them into smaller notes.",
  rate_limited: "The AI service is busy. Try again in a minute.",
  unavailable: "The AI service isn't responding. Try again in a minute.",
  failed: "Something went wrong finding actions. Try again.",
};

const LIMIT_MESSAGES: Record<string, string> = {
  ai_monthly_cap: "You've reached this month's limit for AI suggestions. You can still add actions yourself.",
  ai_hourly_limit: "You've asked for suggestions many times this hour. Try again later.",
  ai_global_cap: "AI suggestions are paused for this month. You can still add actions yourself.",
};

export async function suggestActions(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const noteId = z.uuid().safeParse(formData.get("note_id"));
  if (!noteId.success) return { error: "We couldn't find these notes." };
  if (!aiConfigured()) return { error: "AI suggestions aren't set up yet. You can add actions yourself." };

  const context = await getAppContext();
  const note = await getNote(context, noteId.data);
  if (!note) return { error: "We couldn't find these notes." };
  const meeting = await getMeeting(context, note.meeting_id);
  if (!meeting) return { error: "We couldn't find this meeting." };

  // Reserve the most this can cost before calling, so parallel requests and
  // failed calls all count against the limits.
  // Usage is recorded with the server's own access, for the person whose verified sign-in
  // this is. People can't write usage records themselves.
  const admin = createAdminClient();
  if (!admin) return { error: "AI suggestions aren't set up yet. You can add actions yourself." };
  const model = aiModel();
  const reservation = await admin.rpc("reserve_ai_usage", {
    p_user_id: context.userId,
    p_note_id: note.id,
    p_model: model,
    p_estimate_usd: worstCaseCostUsd(model, note.raw_text.length),
    p_monthly_cap_usd: monthlyCapUsd(),
    p_hourly_limit: hourlyLimit(),
    p_global_cap_usd: globalCapUsd(),
  });
  if (reservation.error) {
    const limit = LIMIT_MESSAGES[reservation.error.message];
    if (limit) return { error: limit };
    logFailure("reserve_ai_usage_failed", reservation.error.code);
    return { error: "We couldn't check your usage. Try again." };
  }
  const usage = reservation.data as { id: string; token: string };

  // "Thursday" means the Thursday after the meeting, in the user's own timezone.
  const meetingDate = todayInZone(context.timezone, new Date(meeting.starts_at));
  const result = await extractActions({
    notes: note.raw_text,
    meetingTitle: meeting.title,
    meetingDate: longDate(meetingDate),
    attendees: meeting.attendees,
  });

  // Without real figures (a timeout), the reserved worst case stays as the charge.
  if (result.usageKnown) {
    const { error } = await admin.rpc("settle_ai_usage", {
      p_user_id: context.userId,
      p_usage_id: usage.id,
      p_token: usage.token,
      p_model: result.model,
      p_input_tokens: result.inputTokens,
      p_output_tokens: result.outputTokens,
      p_cost_usd: costUsd(result.model, result.inputTokens, result.outputTokens),
    });
    if (error) logFailure("settle_ai_usage_failed", error.code);
  }
  if (!result.ok) return { error: FAILURE_MESSAGES[result.reason] };

  const { suggestions, removed } = checkModelActions(note.raw_text, result.actions, meetingDate);
  const { data: added, error } = await context.supabase.rpc("add_suggestions", {
    p_note_id: note.id,
    p_model: result.model,
    p_items: suggestions,
  });
  if (error) {
    logFailure("add_suggestions_failed", error.code);
    return { error: "We couldn't save the suggestions. Try again." };
  }

  // Anything the database turned down is counted with the rest that were removed.
  const skipped = Math.max(0, suggestions.length - (added ?? 0));
  if (skipped) logFailure("add_suggestions_skipped", String(skipped));

  revalidatePath(`/meetings/${meeting.id}`);
  const total = removed + skipped;
  redirect(`/meetings/${meeting.id}/review?note=${note.id}${total ? `&removed=${total}` : ""}`);
}

const confirmSchema = z.object({
  suggestion_id: z.uuid(),
  title: z.string().trim().min(1, "Add a task title.").max(300, "Keep the title under 300 characters."),
  owner_kind: z.enum(["me", "other", "none"]),
  owner_name: z.string().trim().max(200, "Keep the name under 200 characters."),
  due_date: z
    .string()
    .trim()
    .refine((value) => value === "" || isCalendarDate(value), "Enter a valid date."),
});

export async function confirmSuggestion(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = confirmSchema.safeParse({
    suggestion_id: formData.get("suggestion_id"),
    title: formData.get("title") ?? "",
    owner_kind: formData.get("owner_kind"),
    owner_name: formData.get("owner_name") ?? "",
    due_date: formData.get("due_date") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  if (parsed.data.owner_kind === "other" && !parsed.data.owner_name) return { error: "Add the owner's name." };

  const { supabase } = await getAppContext();
  const { data: taskId, error } = await supabase.rpc("confirm_suggestion", {
    p_suggestion_id: parsed.data.suggestion_id,
    p_title: parsed.data.title,
    p_owner_kind: parsed.data.owner_kind,
    p_owner_name: parsed.data.owner_kind === "other" ? parsed.data.owner_name : null,
    p_due_date: parsed.data.due_date || null,
  });
  if (error) {
    logFailure("confirm_suggestion_failed", error.code);
    return { error: "We couldn't confirm this task. Try again." };
  }
  if (taskId) syncAfterResponse([taskId]);
  revalidatePath("/", "layout");
  return { error: null };
}

async function setStatus(formData: FormData, from: "pending" | "dismissed", to: "pending" | "dismissed", failure: string) {
  const id = z.uuid().safeParse(formData.get("suggestion_id"));
  if (!id.success) return { error: failure };
  const { supabase } = await getAppContext();
  const { error } = await supabase.from("suggestions").update({ status: to }).eq("id", id.data).eq("status", from);
  if (error) {
    logFailure(`${to}_suggestion_failed`, error.code);
    return { error: failure };
  }
  revalidatePath("/", "layout");
  return { error: null };
}

export async function dismissSuggestion(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(formData, "pending", "dismissed", "We couldn't dismiss this suggestion. Try again.");
}

export async function restoreSuggestion(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(formData, "dismissed", "pending", "We couldn't restore this suggestion. Try again.");
}

const bulkSchema = z.object({ note_id: z.uuid(), ids: z.array(z.uuid()).min(1).max(30) });

/**
 * Confirms exactly the suggestions listed in the dialog, if they are still waiting
 * and still have an owner, a date and no open questions.
 */
export async function confirmAllComplete(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = bulkSchema.safeParse({ note_id: formData.get("note_id"), ids: formData.getAll("suggestion_id") });
  if (!parsed.success) return { error: "We couldn't confirm these tasks. Try again." };

  const context = await getAppContext();
  const { data, error } = await context.supabase
    .from("suggestions")
    .select("id, title, owner_name, due_date, open_questions")
    .eq("note_id", parsed.data.note_id)
    .eq("status", "pending")
    .in("id", parsed.data.ids);
  if (error) {
    logFailure("bulk_confirm_load_failed", error.code);
    return { error: "We couldn't confirm these tasks. Try again." };
  }

  let failed = parsed.data.ids.length - data.length;
  const confirmed: string[] = [];
  for (const suggestion of data) {
    if (!suggestion.owner_name || !suggestion.due_date || suggestion.open_questions.length) {
      failed += 1;
      continue;
    }
    const mine = looksLikeMe(suggestion.owner_name, context.profile?.full_name);
    const { data: taskId, error: confirmError } = await context.supabase.rpc("confirm_suggestion", {
      p_suggestion_id: suggestion.id,
      p_title: suggestion.title,
      p_owner_kind: mine ? "me" : "other",
      p_owner_name: mine ? null : suggestion.owner_name,
      p_due_date: suggestion.due_date,
    });
    if (confirmError) {
      logFailure("bulk_confirm_failed", confirmError.code);
      failed += 1;
    } else if (taskId) {
      confirmed.push(taskId);
    }
  }
  syncAfterResponse(confirmed);
  revalidatePath("/", "layout");
  if (failed) {
    return { error: failed === 1 ? "1 task couldn't be confirmed. Check it on its own." : `${failed} tasks couldn't be confirmed. Check them one at a time.` };
  }
  return { error: null };
}
