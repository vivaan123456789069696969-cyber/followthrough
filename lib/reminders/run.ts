import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/supabase/env";
import { firstName, safeTimezone } from "@/lib/tasks/dates";
import { renderDigest } from "./email";
import { dueDigest, MAX_PER_EMAIL, pickTasks, prefsFromRow, type Kind, type ReminderTask } from "./plan";
import { sendEmail, sendingEnabled } from "./send";
import { oneClickUrl, unsubscribeConfigured, unsubscribeUrl } from "./unsubscribe";

const log = (event: string, detail: Record<string, unknown> = {}) => console.error(JSON.stringify({ event, ...detail }));

/** No second email within this long of the last one, whatever changed in between. */
const DAY_CAP_MS = 20 * 60 * 60 * 1000;

export type RunSummary ={ checked: number; emailed: number; logged: number; failed: number; skipped: number };

/**
 * Sends every reminder that's due at `now`. Safe to run any number of times, even twice at
 * once: each task is claimed in reminder_log (unique per task, kind and moment) before the
 * email goes, and only tasks this run claimed are included.
 */
export async function runReminders(admin: AdminClient, now: Date, budgetMs = 240_000): Promise<RunSummary> {
  const started = Date.now();
  const summary: RunSummary = { checked: 0, emailed: 0, logged: 0, failed: 0, skipped: 0 };
  // Without a working unsubscribe link, no reminder email may go out at all.
  if (!unsubscribeConfigured()) {
    log("reminders_skipped", { reason: "unsubscribe_not_configured" });
    return summary;
  }

  const { data: rows, error } = await admin
    .from("reminder_prefs")
    .select("user_id, enabled, digest_time, day_before, quiet_start, quiet_end, types, unsubscribe_token")
    .eq("enabled", true)
    .limit(2000);
  if (error) throw new Error(`reminder_prefs_load_failed:${error.code}`);

  for (const row of rows ?? []) {
    if (Date.now() - started > budgetMs) break;
    summary.checked += 1;
    try {
      const outcome = await remindOne(admin, now, row);
      summary[outcome] += 1;
    } catch (error) {
      summary.failed += 1;
      log("reminder_failed", { reason: error instanceof Error ? error.message : "unknown" });
    }
  }
  return summary;
}

type PrefsRow = {
  user_id: string;
  enabled: boolean;
  digest_time: string | null;
  day_before: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  types: Record<string, unknown> | null;
  unsubscribe_token: string;
};

async function remindOne(admin: AdminClient, now: Date, row: PrefsRow): Promise<"emailed" | "logged" | "failed" | "skipped"> {
  const userId = row.user_id;
  const prefs = prefsFromRow(row);
  const { data: profile } = await admin.from("profiles").select("timezone, full_name").eq("id", userId).maybeSingle();
  const timezone = safeTimezone(profile?.timezone);
  const due = dueDigest(now, prefs, timezone);
  if (!due) return "skipped";

  // At most one email a day: changing the time or timezone after today's went out mustn't
  // bring a second one. (Duplicate runs for the same moment are stopped by the claims below.)
  const { data: recent } = await admin
    .from("reminder_log")
    .select("id")
    .eq("user_id", userId)
    .neq("scheduled_for", due.scheduledFor)
    .gt("sent_at", new Date(now.getTime() - DAY_CAP_MS).toISOString())
    .limit(1);
  if (recent?.length) return "skipped";

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return "skipped";

  // Read fresh at send time, so tasks done since the last run are left out.
  const { data: taskRows } = await admin
    .from("tasks")
    .select("id, title, status, due_date, snoozed_until, owner_user_id, owner_contact_id, meeting_id, created_by")
    .eq("workspace_id", membership.workspace_id)
    .eq("status", "open")
    // Only this person's own tasks: ones they own, or made for someone else. In a shared
    // workspace, other members' tasks never reach this person's email.
    .or(`owner_user_id.eq.${userId},created_by.eq.${userId}`)
    .limit(1000);
  const tasks = (taskRows ?? []).map((task) => ({ ...task, meeting_title: null as string | null, owner_name: null as string | null }));
  const all = pickTasks(due.localDate, tasks as ReminderTask[], prefs, userId);
  const picked = all.slice(0, MAX_PER_EMAIL);
  if (!picked.length) return "skipped";

  // Claims from log-only mode don't stop a real email once sending is turned on.
  if (sendingEnabled()) {
    await admin.from("reminder_log").delete().eq("user_id", userId).eq("scheduled_for", due.scheduledFor).eq("resend_id", "logged");
  }

  // Claim before sending. A task already claimed for this moment, by this run or another, is left out.
  const { data: claimed, error: claimError } = await admin
    .from("reminder_log")
    .upsert(
      picked.map(({ kind, task }) => ({ task_id: task.id, user_id: userId, kind, scheduled_for: due.scheduledFor })),
      { onConflict: "task_id,user_id,kind,scheduled_for", ignoreDuplicates: true },
    )
    .select("id, task_id, kind");
  if (claimError) throw new Error(`reminder_claim_failed:${claimError.code}`);
  const mine = new Set((claimed ?? []).map((entry) => `${entry.task_id}:${entry.kind}`));
  const items = picked.filter(({ kind, task }) => mine.has(`${task.id}:${kind}`));
  if (!items.length) return "skipped";
  const logIds = (claimed ?? []).map((entry) => entry.id);
  // Claims are given back unless the email went (or was logged), so nothing is lost to an
  // error in between: the next run within the catch-up window tries again.
  let keep = false;
  try {
    await addContext(admin, items.map((item) => item.task));

    const { data: user } = await admin.auth.admin.getUserById(userId);
    const to = user?.user?.email;
    if (!to) return "skipped";

    const appUrl = getAppUrl();
    const email = renderDigest({
      items,
      more: Math.max(0, all.length - picked.length),
      appUrl,
      unsubscribeUrl: unsubscribeUrl(appUrl, userId, row.unsubscribe_token),
      firstName: firstName(profile?.full_name),
    });
    const result = await sendEmail(
      {
        to,
        ...email,
        headers: {
          // One-click unsubscribe in mail apps (RFC 8058).
          "List-Unsubscribe": `<${oneClickUrl(appUrl, userId, row.unsubscribe_token)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      },
      // One key per exact set of claimed reminders, so Resend drops only true repeats.
      `reminder:${userId}:${[...logIds].sort().join(",")}`.slice(0, 256),
    );

    if (result.sent) {
      keep = true;
      await admin.from("reminder_log").update({ sent_at: new Date().toISOString(), resend_id: result.id }).in("id", logIds);
      return "emailed";
    }
    if (result.logged) {
      // Kept as a claim, but never marked sent: only a real email counts as sent.
      keep = true;
      await admin.from("reminder_log").update({ resend_id: "logged" }).in("id", logIds);
      return "logged";
    }
    log("reminder_send_failed", { reason: result.reason });
    return "failed";
  } finally {
    if (!keep) {
      const { error } = await admin.from("reminder_log").delete().in("id", logIds);
      if (error) log("reminder_release_failed", { code: error.code });
    }
  }
}

/** Meeting titles and owner names, for the "From Product sync" line. */
async function addContext(admin: AdminClient, tasks: (ReminderTask & { meeting_id?: string | null })[]) {
  const meetingIds = [...new Set(tasks.map((task) => task.meeting_id).filter(Boolean))] as string[];
  const contactIds = [...new Set(tasks.map((task) => task.owner_contact_id).filter(Boolean))] as string[];
  const [{ data: meetings }, { data: contacts }] = await Promise.all([
    meetingIds.length ? admin.from("meetings").select("id, title").in("id", meetingIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    contactIds.length
      ? admin.from("contacts").select("id, display_name").in("id", contactIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const titles = new Map((meetings ?? []).map((meeting) => [meeting.id, meeting.title]));
  const names = new Map((contacts ?? []).map((contact) => [contact.id, contact.display_name]));
  for (const task of tasks) {
    task.meeting_title = task.meeting_id ? (titles.get(task.meeting_id) ?? null) : null;
    task.owner_name = task.owner_contact_id ? (names.get(task.owner_contact_id) ?? null) : null;
  }
}

/** The digest as it would look right now, for the preview page. Sends nothing, claims nothing. */
export async function previewFor(
  admin: AdminClient,
  userId: string,
  localDate: string,
): Promise<{ items: { kind: Kind; task: ReminderTask }[]; html: string } | null> {
  const [{ data: row }, { data: profile }, { data: membership }] = await Promise.all([
    admin.from("reminder_prefs").select("user_id, enabled, digest_time, day_before, quiet_start, quiet_end, types, unsubscribe_token").eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    admin.from("workspace_members").select("workspace_id").eq("user_id", userId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (!membership) return null;
  const prefs = { ...prefsFromRow(row), enabled: true };
  const { data: taskRows } = await admin
    .from("tasks")
    .select("id, title, status, due_date, snoozed_until, owner_user_id, owner_contact_id, meeting_id, created_by")
    .eq("workspace_id", membership.workspace_id)
    .eq("status", "open")
    // Only this person's own tasks: ones they own, or made for someone else. In a shared
    // workspace, other members' tasks never reach this person's email.
    .or(`owner_user_id.eq.${userId},created_by.eq.${userId}`)
    .limit(1000);
  const tasks = (taskRows ?? []).map((task) => ({ ...task, meeting_title: null as string | null, owner_name: null as string | null }));
  const all = pickTasks(localDate, tasks as ReminderTask[], prefs, userId);
  const items = all.slice(0, MAX_PER_EMAIL);
  await addContext(admin, items.map((item) => item.task));
  const appUrl = getAppUrl();
  const html = renderDigest({
    items,
    more: all.length - items.length,
    appUrl,
    unsubscribeUrl: `${appUrl}/unsubscribe?preview=1`,
    firstName: firstName(profile?.full_name),
  }).html;
  return { items, html };
}
