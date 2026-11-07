import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/supabase/env";
import type { SyncProvider } from "@/lib/supabase/types";
import { deleteEvent, deleteTask, upsertDeadline, upsertTask } from "./api";
import { ContainerGone, GoogleError, plainError, ReconnectNeeded } from "./http";
import { accessToken, type Integration } from "./integration";
import { MAX_ATTEMPTS, nextAttemptAt, planSync, type Step } from "./plan";

const log = (event: string, detail: Record<string, unknown> = {}) => console.error(JSON.stringify({ event, ...detail }));

// `fresh`: claimed by this run, so nothing can have been made in Google for it yet.
type SyncRow = { id: string; provider: SyncProvider; external_id: string | null; container_id: string | null; attempts: number; fresh?: boolean };

const QUOTE_LIMIT = 1000;

async function loadTask(admin: AdminClient, taskId: string) {
  const { data, error } = await admin
    .from("tasks")
    .select("id, workspace_id, title, status, due_date, source_quote, created_by, meeting_id")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(`sync_task_load_failed:${error.code}`);
  return data;
}

/** The link goes first: it's also how a task is found again in Google, so it must never be cut off. */
function notesFor(task: { id: string; source_quote: string | null }, meetingTitle: string | null) {
  const link = `${getAppUrl()}/my-day?task=${task.id}`;
  const from = meetingTitle ? `From ${meetingTitle.slice(0, 200)}` : "From FollowThrough";
  const quote = task.source_quote
    ? `: “${task.source_quote.length > QUOTE_LIMIT ? `${task.source_quote.slice(0, QUOTE_LIMIT)}…` : task.source_quote}”`
    : "";
  return { notes: `Open in FollowThrough: ${link}\n\n${from}${quote}`, marker: `/my-day?task=${task.id}` };
}

/** Why a sync that can't run now is waiting, shown on the task. */
function idleReason(integration: Integration | null, destination: string | null, provider: SyncProvider): string {
  if (!integration) return "Google isn't connected, so this isn't being sent.";
  if (integration.status !== "active") return "Google needs you to connect again in Settings.";
  if (provider === "google_tasks" && destination !== "google_tasks") return "Google Tasks isn't the chosen destination, so this isn't being sent.";
  if (provider === "google_tasks" && !integration.tasklist_id) return "Choose a Google Tasks list in Settings.";
  if (provider === "google_calendar" && !integration.calendar_id) return "Make the FollowThrough calendar again in Settings.";
  return "Nothing to send to Google right now.";
}

/**
 * Brings Google in line with one task. Safe to run any number of times: it updates what's
 * there rather than adding again. Never throws for Google failures; it records them.
 */
export async function syncTask(admin: AdminClient, taskId: string): Promise<void> {
  const task = await loadTask(admin, taskId);
  if (!task || !task.created_by) return;

  const [{ data: found }, { data: profile }, { data: syncRows }] = await Promise.all([
    admin.from("integrations").select("*").eq("workspace_id", task.workspace_id).eq("user_id", task.created_by).eq("provider", "google").maybeSingle(),
    admin.from("profiles").select("task_destination, timezone").eq("id", task.created_by).maybeSingle(),
    admin.from("task_syncs").select("id, provider, external_id, container_id, attempts, state").eq("task_id", task.id),
  ]);
  const integration = (found ?? null) as Integration | null;
  const destination = profile?.task_destination ?? null;
  const rows = (syncRows ?? []) as (SyncRow & { state: string })[];
  const row = (provider: SyncProvider) => rows.find((sync) => sync.provider === provider);

  const steps = planSync(
    { id: task.id, status: task.status, dueDate: task.due_date },
    integration
      ? { status: integration.status, scopes: integration.scopes, calendarId: integration.calendar_id, tasklistId: integration.tasklist_id }
      : null,
    destination,
    {
      tasks: row("google_tasks") && { provider: "google_tasks", externalId: row("google_tasks")!.external_id },
      calendar: row("google_calendar") && { provider: "google_calendar", externalId: row("google_calendar")!.external_id },
    },
  );

  // Syncs that can't run now are set aside with the reason, so they never sit in the retry
  // queue ahead of real work, and the task says why instead of "waiting" forever.
  const planned = new Set(steps.map((step) => step.provider));
  for (const sync of rows) {
    if (planned.has(sync.provider) || sync.state === "ok") continue;
    await admin
      .from("task_syncs")
      .update({ state: "failed", attempts: MAX_ATTEMPTS, next_attempt_at: null, last_error: idleReason(integration, destination, sync.provider) })
      .eq("id", sync.id);
  }
  if (!steps.length || !integration) return;

  // Only one run may create a task's item in Google. Claiming the row first means a second
  // run at the same moment (a save, the scheduled job, Retry) skips instead of adding a copy.
  const runnable: Step[] = [];
  for (const step of steps) {
    if (row(step.provider)) {
      runnable.push(step);
      continue;
    }
    const { data: claimed, error } = await admin
      .from("task_syncs")
      .insert({ task_id: task.id, workspace_id: task.workspace_id, provider: step.provider, state: "pending", next_attempt_at: new Date(Date.now() + 120_000).toISOString() })
      .select("id, provider, external_id, container_id, attempts")
      .single();
    if (error || !claimed) continue;
    rows.push({ ...(claimed as SyncRow), state: "pending", fresh: true });
    runnable.push(step);
  }
  if (!runnable.length) return;

  let token: string;
  try {
    token = await accessToken(admin, integration);
  } catch (error) {
    for (const step of runnable) await record(admin, row(step.provider)!, step.provider, { error });
    return;
  }

  let meetingTitle: string | null = null;
  if (task.meeting_id) {
    const { data } = await admin.from("meetings").select("title").eq("id", task.meeting_id).maybeSingle();
    meetingTitle = data?.title ?? null;
  }
  const { notes, marker } = notesFor(task, meetingTitle);

  for (const step of runnable) {
    const existing = row(step.provider)!;
    const attempt = () => run(step, token, integration, existing, { ...task, notes, marker });
    try {
      let result;
      try {
        result = await attempt();
      } catch (error) {
        // Google turned the access token away. Refresh once: either it works again, or the
        // refresh fails too and the connection is marked as needing to reconnect.
        if (!(error instanceof GoogleError && error.status === 401)) throw error;
        token = await accessToken(admin, integration, { force: true });
        result = await attempt();
      }
      await record(admin, existing, step.provider, { result });
    } catch (error) {
      // The calendar or list was deleted in Google. Forget it, so Settings offers to replace it.
      if (error instanceof ContainerGone) {
        await admin
          .from("integrations")
          .update(error.kind === "calendar" ? { calendar_id: null } : { tasklist_id: null })
          .eq("id", integration.id);
      }
      await record(admin, existing, step.provider, { error });
    }
  }
}

async function run(
  step: Step,
  token: string,
  integration: Integration,
  existing: SyncRow,
  task: { id: string; title: string; status: string; due_date: string | null; notes: string; marker: string },
): Promise<{ externalId: string | null; containerId: string | null }> {
  if (step.provider === "google_tasks") {
    const listId = integration.tasklist_id!;
    const sameList = existing.container_id === listId;
    // A different list was chosen since: move it there, so there's one copy, not two.
    if (!sameList && existing.external_id && existing.container_id) {
      try {
        await deleteTask(token, existing.container_id, existing.external_id);
      } catch (error) {
        // The old list may be gone too; the copy in the new list matters more.
        log("google_old_task_delete_failed", { reason: error instanceof Error ? error.message : "unknown" });
      }
    }
    const id = await upsertTask(
      token,
      listId,
      sameList ? existing.external_id : null,
      // Done and dismissed tasks are completed in Google.
      { title: task.title, notes: task.notes, dueDate: task.due_date, done: task.status !== "open", marker: task.marker },
      // A row this run didn't just claim may stand for an earlier try that made the task but
      // failed before saving its id, so look for it first.
      { lookForEarlier: !existing.fresh && !(sameList && existing.external_id) },
    );
    return { externalId: id, containerId: listId };
  }

  const calendarId = integration.calendar_id!;
  if (step.action === "delete") {
    await deleteEvent(token, existing.container_id ?? calendarId, step.externalId);
    return { externalId: null, containerId: null };
  }
  const id = await upsertDeadline(token, calendarId, existing.container_id === calendarId ? existing.external_id : null, {
    taskId: task.id,
    title: task.title,
    dueDate: task.due_date!,
    description: task.notes,
  });
  return { externalId: id, containerId: calendarId };
}

async function record(
  admin: AdminClient,
  existing: SyncRow,
  provider: SyncProvider,
  outcome: { result?: { externalId: string | null; containerId: string | null }; error?: unknown },
) {
  let values;
  if (outcome.result) {
    values = {
      state: "ok" as const,
      external_id: outcome.result.externalId,
      container_id: outcome.result.containerId,
      last_error: null,
      last_synced_at: new Date().toISOString(),
      attempts: 0,
      next_attempt_at: null,
    };
  } else {
    // Needs the person to act (reconnect, pick a list): no point retrying on a timer.
    const waitsForPerson = outcome.error instanceof ReconnectNeeded || outcome.error instanceof ContainerGone;
    const attempts = waitsForPerson ? MAX_ATTEMPTS : Math.min((existing.attempts ?? 0) + 1, MAX_ATTEMPTS);
    const next = nextAttemptAt(attempts);
    log("google_sync_failed", { provider, reason: outcome.error instanceof Error ? outcome.error.message : "unknown", attempts });
    values = { state: "failed" as const, last_error: plainError(outcome.error, next !== null), attempts, next_attempt_at: next };
  }
  const { error } = await admin.from("task_syncs").update(values).eq("id", existing.id);
  if (error) log("google_sync_record_failed", { provider, code: error.code });
}

/**
 * Retries whatever is due. Run by the scheduled job; each task is synced as a whole.
 * Stops starting new tasks well before the job's time limit.
 */
export async function syncDue(admin: AdminClient, limit = 50, budgetMs = 240_000): Promise<number> {
  const started = Date.now();
  const { data, error } = await admin
    .from("task_syncs")
    .select("task_id")
    .neq("state", "ok")
    .lt("attempts", MAX_ATTEMPTS)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`sync_due_failed:${error.code}`);
  const taskIds = [...new Set((data ?? []).map((row) => row.task_id))];
  let done = 0;
  for (const taskId of taskIds) {
    if (Date.now() - started > budgetMs) break;
    await syncTask(admin, taskId);
    done += 1;
  }
  return done;
}

/** Marks a task's failed syncs as due now, for the Retry button. */
export async function requeue(admin: AdminClient, taskId: string) {
  await admin.from("task_syncs").update({ attempts: 0, next_attempt_at: null, state: "pending" }).eq("task_id", taskId).neq("state", "ok");
}

/**
 * After connecting, reconnecting, or choosing a list or destination: makes every open task
 * of this person due for sending, so tasks from before the change aren't left behind.
 */
export async function openTaskIds(admin: AdminClient, workspaceId: string, userId: string, limit = 200): Promise<string[]> {
  await admin.from("task_syncs").update({ attempts: 0, next_attempt_at: null }).eq("workspace_id", workspaceId).neq("state", "ok");
  const { data } = await admin
    .from("tasks")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("created_by", userId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((task) => task.id);
}
