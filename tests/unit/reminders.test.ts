// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { instantInZone } = await import("@/lib/tasks/dates");
const { DEFAULT_PREFS, digestMoment, dueDigest, inQuietHours, pickTasks, prefsFromRow } = await import("@/lib/reminders/plan");
const { renderDigest, subjectFor } = await import("@/lib/reminders/email");
const { signUnsubscribe, verifyUnsubscribe } = await import("@/lib/reminders/unsubscribe");

const ON = { ...DEFAULT_PREFS, enabled: true };
const USER = "11111111-1111-4111-8111-111111111111";

describe("local times in a timezone", () => {
  it("handles India (no daylight saving) and California", () => {
    expect(instantInZone("2030-06-03", "08:00", "Asia/Kolkata")).toBe("2030-06-03T02:30:00.000Z");
    expect(instantInZone("2030-06-03", "08:00", "America/Los_Angeles")).toBe("2030-06-03T15:00:00.000Z");
    expect(instantInZone("2030-01-14", "08:00", "America/Los_Angeles")).toBe("2030-01-14T16:00:00.000Z");
  });

  it("gets 08:00 right on the days the clocks change", () => {
    // Spring forward (10 March 2030) and fall back (3 November 2030) in California.
    expect(instantInZone("2030-03-10", "08:00", "America/Los_Angeles")).toBe("2030-03-10T15:00:00.000Z");
    expect(instantInZone("2030-11-03", "08:00", "America/Los_Angeles")).toBe("2030-11-03T16:00:00.000Z");
  });

  it("puts a time the clocks skip just after the gap", () => {
    const skipped = Date.parse(instantInZone("2030-03-10", "02:30", "America/Los_Angeles"));
    expect(skipped).toBeGreaterThanOrEqual(Date.parse("2030-03-10T10:00:00Z"));
    expect(skipped).toBeLessThanOrEqual(Date.parse("2030-03-10T11:00:00Z"));
  });
});

describe("quiet hours", () => {
  it.each([
    ["22:30", "21:00", "07:00", true],
    ["06:59", "21:00", "07:00", true],
    ["07:00", "21:00", "07:00", false],
    ["12:00", "13:00", "14:00", false],
    ["13:30", "13:00", "14:00", true],
    ["08:00", null, null, false],
  ])("%s with quiet %s-%s is quiet: %s", (time, start, end, quiet) => {
    expect(inQuietHours(time, start, end)).toBe(quiet);
  });

  it("moves a digest inside quiet hours to when they end, never drops it", () => {
    const early = { ...ON, digestTime: "06:00" };
    expect(digestMoment("2030-06-03", early, "Asia/Kolkata")).toBe(instantInZone("2030-06-03", "07:00", "Asia/Kolkata"));
    // A late digest in quiet hours that wrap midnight goes out the next morning.
    const late = { ...ON, digestTime: "22:00" };
    expect(digestMoment("2030-06-03", late, "Asia/Kolkata")).toBe(instantInZone("2030-06-04", "07:00", "Asia/Kolkata"));
  });
});

describe("when a digest is due", () => {
  it("is due from the chosen time, in the person's own timezone, for a few hours", () => {
    const at = (iso: string) => dueDigest(new Date(iso), ON, "Asia/Kolkata");
    expect(at("2030-06-03T02:29:00Z")).toBeNull();
    expect(at("2030-06-03T02:30:00Z")).toEqual({ localDate: "2030-06-03", scheduledFor: "2030-06-03T02:30:00.000Z" });
    // A late or missed run still sends it, within three hours.
    expect(at("2030-06-03T05:29:00Z")?.localDate).toBe("2030-06-03");
    expect(at("2030-06-03T05:31:00Z")).toBeNull();
  });

  it("is due at different moments for India and California", () => {
    const now = new Date("2030-06-03T15:05:00Z");
    expect(dueDigest(now, ON, "America/Los_Angeles")?.localDate).toBe("2030-06-03");
    expect(dueDigest(now, ON, "Asia/Kolkata")).toBeNull();
  });

  it("sends yesterday's digest that quiet hours pushed past midnight", () => {
    const late = { ...ON, digestTime: "22:00" };
    expect(dueDigest(new Date("2030-06-04T01:35:00Z"), late, "Asia/Kolkata")).toEqual({
      localDate: "2030-06-03",
      scheduledFor: "2030-06-04T01:30:00.000Z",
    });
  });

  it("doesn't send during quiet hours, even when catching up after a late run", () => {
    // Email at 20:00, quiet from 21:00: a run at 21:15 is within the catch-up window but quiet.
    const evening = { ...ON, digestTime: "20:00" };
    expect(dueDigest(new Date("2030-06-03T14:35:00Z"), evening, "Asia/Kolkata")?.localDate).toBe("2030-06-03");
    expect(dueDigest(new Date("2030-06-03T15:45:00Z"), evening, "Asia/Kolkata")).toBeNull();
  });

  it("is never due while reminders are off", () => {
    expect(dueDigest(new Date("2030-06-03T02:35:00Z"), DEFAULT_PREFS, "Asia/Kolkata")).toBeNull();
  });

  it("fills in the chosen defaults for a missing or partial row", () => {
    expect(prefsFromRow(null)).toEqual(DEFAULT_PREFS);
    expect(prefsFromRow({ enabled: true, digest_time: "09:30:00", day_before: true, quiet_start: null, quiet_end: null, types: { overdue: false } })).toEqual({
      ...DEFAULT_PREFS,
      enabled: true,
      digestTime: "09:30",
      dayBefore: true,
      quietStart: null,
      quietEnd: null,
      overdue: false,
    });
  });
});

describe("what goes in the email", () => {
  const task = (overrides: Record<string, unknown>) => ({
    id: String(Math.random()),
    title: "Task",
    status: "open" as const,
    due_date: null as string | null,
    snoozed_until: null as string | null,
    owner_user_id: USER as string | null,
    owner_contact_id: null as string | null,
    meeting_title: null,
    ...overrides,
  });
  // 3 June 2030 is a Monday.
  const day = "2030-06-03";

  it("includes due today and overdue up to 7 days, but not older", () => {
    const tasks = [task({ title: "today", due_date: day }), task({ title: "late", due_date: "2030-05-27" }), task({ title: "too late", due_date: "2030-05-26" })];
    expect(pickTasks(day, tasks, ON, USER).map((item) => [item.kind, item.task.title])).toEqual([
      ["due_today", "today"],
      ["overdue", "late"],
    ]);
  });

  it("includes tomorrow only with '1 day before' on", () => {
    const tasks = [task({ due_date: "2030-06-04" })];
    expect(pickTasks(day, tasks, ON, USER)).toEqual([]);
    expect(pickTasks(day, tasks, { ...ON, dayBefore: true }, USER).map((item) => item.kind)).toEqual(["due_tomorrow"]);
  });

  it("leaves out done, snoozed, undated and other people's tasks", () => {
    const tasks = [
      task({ status: "done", due_date: day }),
      task({ due_date: day, snoozed_until: "2030-06-05" }),
      task({}),
      task({ due_date: day, owner_user_id: null, owner_contact_id: "c1" }),
    ];
    expect(pickTasks(day, tasks, ON, USER)).toEqual([]);
  });

  it("lists other people's tasks on Mondays when the weekly digest is on", () => {
    const theirs = [
      task({ title: "a contact's", owner_user_id: null, owner_contact_id: "c1" }),
      task({ title: "a teammate's", owner_user_id: "22222222-2222-4222-8222-222222222222" }),
    ];
    expect(pickTasks(day, theirs, { ...ON, waitingWeekly: true }, USER).map((item) => item.kind)).toEqual(["waiting_weekly", "waiting_weekly"]);
    expect(pickTasks("2030-06-04", theirs, { ...ON, waitingWeekly: true }, USER)).toEqual([]);
  });

  it("puts what's due today first, so a long list never hides it", () => {
    const tasks = [
      task({ title: "tomorrow", due_date: "2030-06-04" }),
      task({ title: "late", due_date: "2030-06-01" }),
      task({ title: "today", due_date: day }),
    ];
    expect(pickTasks(day, tasks, { ...ON, dayBefore: true }, USER).map((item) => item.task.title)).toEqual(["today", "late", "tomorrow"]);
  });

  it("says when only tomorrow's tasks are in it", () => {
    const tomorrow = [{ kind: "due_tomorrow" as const, task: task({}) }, { kind: "due_tomorrow" as const, task: task({}) }];
    expect(subjectFor(tomorrow)).toBe("2 things due tomorrow");
  });

  it("says how many more there are when the email is full", () => {
    const email = renderDigest({
      items: [{ kind: "due_today", task: task({ id: "t-1", title: "First" }) }],
      more: 4,
      appUrl: "https://app.test",
      unsubscribeUrl: "https://app.test/unsubscribe?u=x&s=y",
      firstName: null,
    });
    expect(email.text).toContain("And 4 more in FollowThrough. https://app.test/my-day");
    expect(email.html).toContain('aria-label="Open task: First"');
  });

  it("keeps the subject to one line, whatever the title holds", () => {
    expect(subjectFor([{ kind: "due_today", task: task({ title: "Send\r\nBcc: x@y.z" }) }])).toBe("Due today: Send Bcc: x@y.z");
  });

  it("writes plain subjects", () => {
    const one = [{ kind: "due_today" as const, task: task({ title: "Send revised launch brief" }) }];
    expect(subjectFor(one)).toBe("Due today: Send revised launch brief");
    expect(subjectFor([...one, { kind: "overdue" as const, task: task({}) }, { kind: "overdue" as const, task: task({}) }])).toBe("3 things need you today");
  });

  it("escapes task text, links each task and offers a way out", () => {
    const email = renderDigest({
      items: [{ kind: "due_today", task: task({ id: "t-1", title: "<script>x</script> & co", meeting_title: "Product sync" }) }],
      appUrl: "https://app.test",
      unsubscribeUrl: "https://app.test/unsubscribe?u=x&s=y",
      firstName: "Maya",
    });
    expect(email.html).not.toContain("<script>x</script>");
    expect(email.html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; co");
    expect(email.html).toContain("From Product sync");
    expect(email.html).toContain('href="https://app.test/my-day?task=t-1"');
    expect(email.html).toContain("Turn off reminders");
    expect(email.html).toContain("prefers-color-scheme: dark");
    expect(email.html).not.toMatch(/<img/);
    expect(email.text).toContain("Open task: https://app.test/my-day?task=t-1");
    expect(email.text).toContain("Turn off reminders: https://app.test/unsubscribe?u=x&s=y");
    expect(`${email.subject}${email.text}`).not.toContain("!");
  });
});

describe("unsubscribe links", () => {
  it("are accepted only with the right person, token and secret", () => {
    process.env.UNSUBSCRIBE_SECRET = "a".repeat(40);
    const signature = signUnsubscribe(USER, "token-1");
    expect(verifyUnsubscribe(USER, "token-1", signature)).toBe(true);
    expect(verifyUnsubscribe("22222222-2222-4222-8222-222222222222", "token-1", signature)).toBe(false);
    // A new token (after a reset) makes old links stop working.
    expect(verifyUnsubscribe(USER, "token-2", signature)).toBe(false);
    expect(verifyUnsubscribe(USER, "token-1", "forged")).toBe(false);

    process.env.UNSUBSCRIBE_SECRET = "b".repeat(40);
    expect(verifyUnsubscribe(USER, "token-1", signature)).toBe(false);
    process.env.UNSUBSCRIBE_SECRET = "short";
    expect(verifyUnsubscribe(USER, "token-1", signature)).toBe(false);
  });
});
