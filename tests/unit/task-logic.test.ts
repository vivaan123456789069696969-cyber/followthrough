import { describe, expect, it } from "vitest";
import { computeStats, isSnoozed, myOpenTasks, needsDate, needsOwner, nextActions, type TaskFacts } from "@/lib/tasks/logic";

const ME = "me";
const today = "2026-10-20";

function task(overrides: Partial<TaskFacts> & { id?: string } = {}): TaskFacts & { id: string } {
  return {
    id: "t",
    owner_user_id: ME,
    owner_contact_id: null,
    due_date: today,
    snoozed_until: null,
    status: "open",
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeStats", () => {
  it("is all zero with no tasks", () => {
    expect(computeStats([], ME, today)).toEqual({ dueSoon: 0, overdue: 0, waiting: 0 });
  });

  it("counts my tasks due today through the next 7 days as due soon", () => {
    const stats = computeStats(
      [task({ due_date: today }), task({ due_date: "2026-10-27" }), task({ due_date: "2026-10-28" }), task({ due_date: null })],
      ME,
      today,
    );
    expect(stats.dueSoon).toBe(2);
  });

  it("counts my past-due tasks as overdue and not as due soon", () => {
    expect(computeStats([task({ due_date: "2026-10-19" })], ME, today)).toEqual({ dueSoon: 0, overdue: 1, waiting: 0 });
  });

  it("counts open tasks owned by someone else as waiting, whatever their date", () => {
    const stats = computeStats(
      [task({ owner_user_id: null, owner_contact_id: "c", due_date: "2026-10-19" }), task({ owner_user_id: null, owner_contact_id: "c", due_date: null })],
      ME,
      today,
    );
    expect(stats).toEqual({ dueSoon: 0, overdue: 0, waiting: 2 });
  });

  it("leaves blank-owner tasks out of all three tiles", () => {
    expect(computeStats([task({ owner_user_id: null })], ME, today)).toEqual({ dueSoon: 0, overdue: 0, waiting: 0 });
  });

  it("ignores finished and dismissed tasks", () => {
    const stats = computeStats(
      [task({ status: "done" }), task({ status: "dismissed", due_date: "2026-10-19" }), task({ status: "done", owner_user_id: null, owner_contact_id: "c" })],
      ME,
      today,
    );
    expect(stats).toEqual({ dueSoon: 0, overdue: 0, waiting: 0 });
  });

  it("still counts a snoozed task, so a snooze can't hide a missed deadline", () => {
    const stats = computeStats([task({ due_date: "2026-10-19", snoozed_until: "2026-10-25" })], ME, today);
    expect(stats.overdue).toBe(1);
  });

  it("depends on the date in the user's timezone", () => {
    const due = task({ due_date: "2026-10-20" });
    expect(computeStats([due], ME, "2026-10-20").overdue).toBe(0); // still Oct 20 in California
    expect(computeStats([due], ME, "2026-10-21").overdue).toBe(1); // already Oct 21 in India
  });
});

describe("nextActions", () => {
  it("sorts by urgency: overdue, then by date, then no date", () => {
    const tasks = [
      task({ id: "none", due_date: null }),
      task({ id: "later", due_date: "2026-10-25" }),
      task({ id: "overdue", due_date: "2026-10-18" }),
      task({ id: "today", due_date: today }),
    ];
    expect(nextActions(tasks, ME, today).visible.map((t) => t.id)).toEqual(["overdue", "today", "later", "none"]);
  });

  it("breaks ties with the oldest first", () => {
    const tasks = [task({ id: "newer", created_at: "2026-10-02T00:00:00Z" }), task({ id: "older", created_at: "2026-10-01T00:00:00Z" })];
    expect(nextActions(tasks, ME, today).visible.map((t) => t.id)).toEqual(["older", "newer"]);
  });

  it("shows five at most and reports the total", () => {
    const { visible, total } = nextActions(Array.from({ length: 7 }, (_, i) => task({ id: String(i) })), ME, today);
    expect(visible).toHaveLength(5);
    expect(total).toBe(7);
  });

  it("includes tasks with no owner yet, but not other people's", () => {
    const tasks = [task({ id: "blank", owner_user_id: null }), task({ id: "theirs", owner_user_id: null, owner_contact_id: "c" })];
    expect(nextActions(tasks, ME, today).visible.map((t) => t.id)).toEqual(["blank"]);
  });

  it("hides a task until its snooze ends", () => {
    const snoozed = task({ snoozed_until: "2026-10-21" });
    expect(nextActions([snoozed], ME, today).total).toBe(0);
    expect(nextActions([snoozed], ME, "2026-10-21").total).toBe(1);
  });

  it("keeps a snoozed task in the full list", () => {
    expect(myOpenTasks([task({ snoozed_until: "2026-10-21" })], ME)).toHaveLength(1);
    expect(isSnoozed(task({ snoozed_until: "2026-10-21" }), today)).toBe(true);
  });
});

describe("badges", () => {
  it("flags missing owner and date on open tasks only", () => {
    expect(needsOwner(task({ owner_user_id: null }))).toBe(true);
    expect(needsOwner(task({ owner_user_id: null, owner_contact_id: "c" }))).toBe(false);
    expect(needsOwner(task({ owner_user_id: null, status: "done" }))).toBe(false);
    expect(needsDate(task({ due_date: null }))).toBe(true);
    expect(needsDate(task({ due_date: null, status: "done" }))).toBe(false);
  });
});
