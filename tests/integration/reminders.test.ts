// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/test-db";

let db: TestDb;
let maya: { userId: string; workspaceId: string };
let other: { userId: string; workspaceId: string };

beforeAll(async () => {
  db = await createTestDb();
  maya = await db.signUp("maya@example.com");
  other = await db.signUp("other@example.com");
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("reminder settings", () => {
  it("start off, with 08:00 and quiet hours 21:00 to 07:00", async () => {
    await db.asUser(maya.userId, "insert into public.reminder_prefs (user_id) values ($1)", [maya.userId]);
    const { rows } = await db.admin("select enabled, digest_time::text as digest, quiet_start::text as qs, quiet_end::text as qe from public.reminder_prefs where user_id = $1", [
      maya.userId,
    ]);
    expect(rows[0]).toEqual({ enabled: false, digest: "08:00:00", qs: "21:00:00", qe: "07:00:00" });
  });

  it("can be changed by their owner only", async () => {
    await db.asUser(maya.userId, "update public.reminder_prefs set enabled = true where user_id = $1", [maya.userId]);
    await db.asUser(other.userId, "update public.reminder_prefs set enabled = false where user_id = $1", [maya.userId]);
    const { rows } = await db.admin<{ enabled: boolean }>("select enabled from public.reminder_prefs where user_id = $1", [maya.userId]);
    expect(rows[0]!.enabled).toBe(true);
  });

  it("never show the unsubscribe token to the person", async () => {
    await expect(db.asUser(maya.userId, "select unsubscribe_token from public.reminder_prefs")).rejects.toThrow(/permission denied/);
  });
});

describe("reminder log", () => {
  async function task() {
    const { rows } = await db.admin<{ id: string }>("insert into public.tasks (workspace_id, title, created_by) values ($1, 'Send it', $2) returning id", [
      maya.workspaceId,
      maya.userId,
    ]);
    return rows[0]!.id;
  }

  it("claims each task once per kind and moment, so a second run sends nothing", async () => {
    const taskId = await task();
    const claim = () =>
      db.admin<{ id: string }>(
        `insert into public.reminder_log (task_id, user_id, kind, scheduled_for) values ($1, $2, 'due_today', '2030-06-03T02:30:00Z')
         on conflict (task_id, user_id, kind, scheduled_for) do nothing returning id`,
        [taskId, maya.userId],
      );
    expect((await claim()).rows).toHaveLength(1);
    expect((await claim()).rows).toHaveLength(0);
  });

  it("only accepts known kinds", async () => {
    const taskId = await task();
    await expect(
      db.admin("insert into public.reminder_log (task_id, user_id, kind, scheduled_for) values ($1, $2, 'spam', now())", [taskId, maya.userId]),
    ).rejects.toThrow(/check constraint/);
  });

  it("can't be written by people, only read for their own reminders", async () => {
    const taskId = await task();
    await expect(
      db.asUser(maya.userId, "insert into public.reminder_log (task_id, user_id, kind, scheduled_for) values ($1, $2, 'due_today', now())", [taskId, maya.userId]),
    ).rejects.toThrow(/permission denied/);
  });
});
