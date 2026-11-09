// Decides when a person's reminder email is due and what goes in it. Pure: it takes the
// time as an argument, so every timezone, daylight-saving and quiet-hours case can be
// tested with a fake clock.

import { addDays, instantInZone, todayInZone } from "@/lib/tasks/dates";

export type ReminderPrefs = {
  enabled: boolean;
  digestTime: string; // "08:00"
  dayBefore: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  dueToday: boolean;
  overdue: boolean;
  waitingWeekly: boolean;
};

export const DEFAULT_PREFS: ReminderPrefs = {
  enabled: false,
  digestTime: "08:00",
  dayBefore: false,
  quietStart: "21:00",
  quietEnd: "07:00",
  dueToday: true,
  overdue: true,
  waitingWeekly: false,
};

type Row = {
  enabled: boolean;
  digest_time: string | null;
  day_before: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  types: Record<string, unknown> | null;
};

const hhmm = (value: string | null | undefined, fallback: string | null) => (value ? value.slice(0, 5) : fallback);

/** A stored row (or none) as the settings the planner uses, with the chosen defaults filled in. */
export function prefsFromRow(row: Row | null): ReminderPrefs {
  if (!row) return DEFAULT_PREFS;
  const types = row.types ?? {};
  const flag = (key: string, fallback: boolean) => (typeof types[key] === "boolean" ? (types[key] as boolean) : fallback);
  return {
    enabled: row.enabled,
    digestTime: hhmm(row.digest_time, DEFAULT_PREFS.digestTime)!,
    dayBefore: row.day_before,
    quietStart: hhmm(row.quiet_start, null),
    quietEnd: hhmm(row.quiet_end, null),
    dueToday: flag("due_today", true),
    overdue: flag("overdue", true),
    waitingWeekly: flag("waiting_weekly", false),
  };
}

/** True if a wall-clock time is inside quiet hours. The range may wrap past midnight. */
export function inQuietHours(time: string, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  return start < end ? time >= start && time < end : time >= start || time < end;
}

/**
 * When the digest for one local date goes out: the chosen time, or the end of quiet hours
 * if the chosen time falls inside them. Deferred, never dropped.
 */
export function digestMoment(localDate: string, prefs: ReminderPrefs, timezone: string): string {
  if (!inQuietHours(prefs.digestTime, prefs.quietStart, prefs.quietEnd)) return instantInZone(localDate, prefs.digestTime, timezone);
  // Quiet hours that wrap past midnight end the next morning when the chosen time is late.
  const nextDay = prefs.quietStart! > prefs.quietEnd! && prefs.digestTime >= prefs.quietStart!;
  return instantInZone(nextDay ? addDays(localDate, 1) : localDate, prefs.quietEnd!, timezone);
}

/** The wall-clock time ("08:05") at an instant in a timezone. */
export function localTime(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(now);
}

/** How late a digest may still go out, if the job was late or missed a run. */
export const CATCH_UP_MS = 3 * 60 * 60 * 1000;

/**
 * The digest due right now, if any: which local date it's for and the moment it's for.
 * Yesterday is checked too, for a digest pushed past midnight by quiet hours.
 */
export function dueDigest(now: Date, prefs: ReminderPrefs, timezone: string): { localDate: string; scheduledFor: string } | null {
  if (!prefs.enabled) return null;
  // Never inside quiet hours, even when catching up after a late run.
  if (inQuietHours(localTime(now, timezone), prefs.quietStart, prefs.quietEnd)) return null;
  const today = todayInZone(timezone, now);
  for (const localDate of [today, addDays(today, -1)]) {
    const moment = digestMoment(localDate, prefs, timezone);
    const at = Date.parse(moment);
    if (now.getTime() >= at && now.getTime() < at + CATCH_UP_MS) return { localDate, scheduledFor: moment };
  }
  return null;
}

export type ReminderTask = {
  id: string;
  title: string;
  status: "open" | "done" | "dismissed";
  due_date: string | null;
  snoozed_until: string | null;
  owner_user_id: string | null;
  owner_contact_id: string | null;
  meeting_title: string | null;
  owner_name?: string | null;
};

export type Kind = "overdue" | "due_today" | "due_tomorrow" | "waiting_weekly";

/** How long an overdue task keeps appearing in the digest. */
export const OVERDUE_DAYS = 7;

/**
 * What goes in one person's digest for a local date. Only open, unsnoozed tasks the
 * person owns, except the weekly "waiting on others" list, which is tasks others own.
 */
export function pickTasks(localDate: string, tasks: ReminderTask[], prefs: ReminderPrefs, userId: string): { kind: Kind; task: ReminderTask }[] {
  const picked: { kind: Kind; task: ReminderTask }[] = [];
  const tomorrow = addDays(localDate, 1);
  const oldestOverdue = addDays(localDate, -OVERDUE_DAYS);
  const monday = new Date(`${localDate}T00:00:00Z`).getUTCDay() === 1;

  for (const task of tasks) {
    if (task.status !== "open") continue;
    if (task.snoozed_until && task.snoozed_until > localDate) continue;
    const mine = task.owner_user_id === userId;

    if (mine && task.due_date) {
      if (prefs.overdue && task.due_date < localDate && task.due_date >= oldestOverdue) picked.push({ kind: "overdue", task });
      else if (prefs.dueToday && task.due_date === localDate) picked.push({ kind: "due_today", task });
      else if (prefs.dayBefore && task.due_date === tomorrow) picked.push({ kind: "due_tomorrow", task });
    } else if (!mine && (task.owner_contact_id || task.owner_user_id) && prefs.waitingWeekly && monday) {
      // Anyone else: a contact or another member of the workspace.
      picked.push({ kind: "waiting_weekly", task });
    }
  }
  // What needs the person most comes first, so a long list never hides today's tasks.
  const order: Record<Kind, number> = { due_today: 0, overdue: 1, due_tomorrow: 2, waiting_weekly: 3 };
  return picked.sort((a, b) => order[a.kind] - order[b.kind] || (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999"));
}

/** The most tasks in one email. More than this is a sign to look at the app, not the inbox. */
export const MAX_PER_EMAIL = 25;
