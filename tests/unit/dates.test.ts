import { describe, expect, it } from "vitest";
import {
  addDays,
  dueLabel,
  firstName,
  greeting,
  isCalendarDate,
  localToUtc,
  longDate,
  meetingTime,
  safeTimezone,
  todayInZone,
  utcToLocalInput,
} from "@/lib/tasks/dates";

describe("todayInZone", () => {
  // 20:00 UTC on Oct 20 is already Oct 21 in India and still Oct 20 in California.
  const instant = new Date("2026-10-20T20:00:00Z");

  it.each([
    ["Asia/Kolkata", "2026-10-21"],
    ["America/Los_Angeles", "2026-10-20"],
    ["UTC", "2026-10-20"],
    ["Pacific/Auckland", "2026-10-21"],
  ])("in %s is %s", (timezone, expected) => {
    expect(todayInZone(timezone, instant)).toBe(expected);
  });
});

describe("addDays", () => {
  it.each([
    ["2026-10-31", 1, "2026-11-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-03-07", 1, "2026-03-08"], // US clocks change this night
  ])("%s plus %i is %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});

describe("dueLabel", () => {
  const today = "2026-10-20"; // a Tuesday, as in the concept deck

  it.each([
    [null, "No date", "none"],
    ["2026-10-19", "Overdue · Oct 19", "overdue"],
    ["2026-10-20", "Today", "today"],
    ["2026-10-21", "Tomorrow", "upcoming"],
    ["2026-10-23", "Fri", "upcoming"],
    ["2026-10-26", "Mon", "upcoming"],
    ["2026-10-27", "Oct 27", "upcoming"],
    ["2027-01-05", "Jan 5, 2027", "upcoming"],
  ])("%s reads as %s", (due, label, tone) => {
    expect(dueLabel(due, today)).toEqual({ label, tone });
  });
});

describe("greeting", () => {
  it.each([
    ["2026-10-20T03:00:00Z", "Asia/Kolkata", "Good morning"], // 8:30
    ["2026-10-20T08:00:00Z", "Asia/Kolkata", "Good afternoon"], // 13:30
    ["2026-10-20T13:00:00Z", "Asia/Kolkata", "Good evening"], // 18:30
    ["2026-10-20T07:00:00Z", "America/Los_Angeles", "Good morning"], // 0:00
    ["2026-10-20T19:00:00Z", "America/Los_Angeles", "Good afternoon"], // 12:00
  ])("at %s in %s says %s", (instant, timezone, expected) => {
    expect(greeting(timezone, new Date(instant))).toBe(expected);
  });
});

describe("localToUtc", () => {
  it.each([
    ["2026-10-20T14:30", "Asia/Kolkata", "2026-10-20T09:00:00.000Z"],
    ["2026-10-20T14:30", "UTC", "2026-10-20T14:30:00.000Z"],
    ["2026-01-15T09:00", "America/New_York", "2026-01-15T14:00:00.000Z"], // winter time
    ["2026-07-15T09:00", "America/New_York", "2026-07-15T13:00:00.000Z"], // summer time
  ])("%s in %s is %s", (local, timezone, expected) => {
    expect(localToUtc(local, timezone)?.toISOString()).toBe(expected);
  });

  it.each(["2026-13-01T10:00", "2026-02-30T10:00", "2026-10-20T25:00", "yesterday", ""])("rejects %j", (local) => {
    expect(localToUtc(local, "UTC")).toBeNull();
  });

  it.each(["Asia/Kolkata", "America/New_York", "Pacific/Auckland"])("round-trips through a form in %s", (timezone) => {
    const iso = "2026-07-15T09:45:00.000Z";
    expect(localToUtc(utcToLocalInput(iso, timezone), timezone)?.toISOString()).toBe(iso);
  });
});

describe("small helpers", () => {
  it("formats the dashboard date", () => {
    expect(longDate("2026-10-20")).toBe("Tuesday, October 20");
  });

  it("formats a meeting time in the user's timezone", () => {
    expect(meetingTime("2026-10-20T09:00:00Z", "Asia/Kolkata")).toBe("Oct 20, 2:30 PM");
  });

  it.each([
    ["Maya Chen", "Maya"],
    ["  Maya  ", "Maya"],
    ["", null],
    [null, null],
  ])("finds the first name in %j", (name, expected) => {
    expect(firstName(name)).toBe(expected);
  });

  it("falls back to UTC for a missing or bad timezone", () => {
    expect(safeTimezone(null)).toBe("UTC");
    expect(safeTimezone("Mars/Olympus")).toBe("UTC");
    expect(safeTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
  });

  it("checks real calendar dates", () => {
    expect(isCalendarDate("2026-10-20")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("10/20/2026")).toBe(false);
  });
});
