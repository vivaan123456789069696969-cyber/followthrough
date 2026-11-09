// Date logic for tasks and meetings. Due dates are plain calendar dates ("2026-10-22"),
// so "today" always comes from the user's timezone, never the server's.

import { isValidTimezone } from "@/lib/auth/timezone";

export function safeTimezone(timezone: string | null | undefined): string {
  return isValidTimezone(timezone) ? timezone : "UTC";
}

/** Today's calendar date in a timezone, as YYYY-MM-DD. */
export function todayInZone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function calendarDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

function formatCalendar(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(calendarDate(date));
}

export function addDays(date: string, days: number): string {
  const result = calendarDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return calendarDate(value).toISOString().slice(0, 10) === value;
}

export type DueTone = "overdue" | "today" | "upcoming" | "none";

/** The short label on a task, such as Today, Tomorrow, Fri or Oct 30. */
export function dueLabel(due: string | null, today: string): { label: string; tone: DueTone } {
  if (!due) return { label: "No date", tone: "none" };
  if (due < today) return { label: `Overdue · ${formatCalendar(due, { month: "short", day: "numeric" })}`, tone: "overdue" };
  if (due === today) return { label: "Today", tone: "today" };
  if (due === addDays(today, 1)) return { label: "Tomorrow", tone: "upcoming" };
  if (due < addDays(today, 7)) return { label: formatCalendar(due, { weekday: "short" }), tone: "upcoming" };

  const sameYear = due.slice(0, 4) === today.slice(0, 4);
  return {
    label: formatCalendar(due, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }),
    tone: "upcoming",
  };
}

export function greeting(timezone: string, now: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Tuesday, October 20" */
export function longDate(date: string): string {
  return formatCalendar(date, { weekday: "long", month: "long", day: "numeric" });
}

export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || null;
}

function zoneOffsetMs(utc: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asIfUtc - Math.floor(utc.getTime() / 1000) * 1000;
}

/** Turns a date and time typed in a form ("2026-10-20T14:30") into an instant in that timezone. */
export function localToUtc(local: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match || !isCalendarDate(local.slice(0, 10))) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  if (hour > 23 || minute > 59) return null;

  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  // The offset depends on the instant, so check twice to settle across clock changes.
  const first = wallClock - zoneOffsetMs(new Date(wallClock), timezone);
  return new Date(wallClock - zoneOffsetMs(new Date(first), timezone));
}

/** The value a datetime-local input needs to show this instant in a timezone. */
export function utcToLocalInput(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "Oct 20, 2:30 PM" */
/**
 * Midday on a calendar date in a timezone, as an ISO instant. Used for all-day calendar
 * events, so the meeting lands on the right day everywhere and no exact time is invented.
 */
export function middayInZone(date: string, timezone: string): string {
  return instantInZone(date, "12:00", timezone);
}

/**
 * The moment a local date and wall-clock time ("08:00") happen in a timezone, as an ISO
 * instant. Works across daylight saving changes; a time skipped by a spring-forward
 * lands just after the gap.
 */
export function instantInZone(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes: the offset can differ between the first guess and the answer near a change.
  let guess = target;
  for (let pass = 0; pass < 2; pass++) guess = target - (wallClock(guess, timezone) - guess);
  // The time doesn't exist that day (clocks jumped past it): move forward by the jump, as
  // a wall clock does, so 02:30 becomes 03:30 instead of 01:30.
  const shortBy = target - wallClock(guess, timezone);
  if (shortBy > 0) guess += shortBy;
  return new Date(guess).toISOString();
}

/** Local wall-clock time in a zone at an instant, read back as if it were UTC. */
function wallClock(instant: number, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
}

export function meetingTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
