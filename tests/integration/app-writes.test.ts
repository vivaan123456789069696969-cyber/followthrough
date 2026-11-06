// @vitest-environment node
//
// Runs the exact writes the app makes as a signed-in user, so the column grants and
// the app can't drift apart. Browser tests use a fake server, which wouldn't notice.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/test-db";

let db: TestDb;
let userId: string;
let workspaceId: string;

beforeAll(async () => {
  db = await createTestDb();
  ({ userId, workspaceId } = await db.signUp("maya@example.com"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

const one = async (sql: string, params: unknown[]) => (await db.asUser<{ id: string }>(userId, `${sql} returning id`, params)).rows[0]!.id;

describe("what the app writes", () => {
  it("runs the whole flow: meeting, notes, contact, task, done, snooze, activity", async () => {
    const meeting = await one("insert into public.meetings (title, starts_at, attendees, workspace_id) values ('Product sync', now(), '[\"Maya\"]', $1)", [workspaceId]);
    await db.asUser(userId, "update public.meetings set title = 'Sync', starts_at = now(), attendees = '[]' where id = $1", [meeting]);

    const note = await one(
      "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, has_timestamps, created_by) values ($1, $2, 'Notes', 'paste', false, $3)",
      [meeting, workspaceId, userId],
    );

    const contact = await one("insert into public.contacts (workspace_id, display_name) values ($1, 'Sam')", [workspaceId]);

    const task = await one(
      "insert into public.tasks (title, description, owner_user_id, owner_contact_id, due_date, workspace_id, meeting_id, created_by) values ('Send brief', null, $1, null, '2026-10-22', $2, $3, $1)",
      [userId, workspaceId, meeting],
    );
    await db.asUser(userId, "insert into public.task_events (task_id, workspace_id, actor_id, type) values ($1, $2, $3, 'created')", [task, workspaceId, userId]);

    await db.asUser(userId, "update public.tasks set title = 'x', description = 'y', owner_user_id = null, owner_contact_id = $1, due_date = null where id = $2", [contact, task]);
    await db.asUser(userId, "update public.tasks set status = 'done', completed_at = now() where id = $1", [task]);
    await db.asUser(userId, "update public.tasks set status = 'open', completed_at = null where id = $1", [task]);
    await db.asUser(userId, "update public.tasks set snoozed_until = '2026-11-01' where id = $1", [task]);

    for (const type of ["edited", "done", "reopened", "snoozed"]) {
      await db.asUser(userId, "insert into public.task_events (task_id, workspace_id, actor_id, type) values ($1, $2, $3, $4)", [task, workspaceId, userId, type]);
    }

    const events = await db.asUser(userId, "select type from public.task_events where task_id = $1", [task]);
    expect(events.rows).toHaveLength(5);

    await db.asUser(userId, "delete from public.meeting_notes where id = $1", [note]);
    await db.asUser(userId, "delete from public.meetings where id = $1", [meeting]);
    const kept = await db.asUser<{ meeting_id: string | null }>(userId, "select meeting_id from public.tasks where id = $1", [task]);
    expect(kept.rows).toEqual([{ meeting_id: null }]);
  });

  it("reads exactly the columns the app selects", async () => {
    await db.asUser(
      userId,
      "select id, title, description, meeting_id, owner_user_id, owner_contact_id, due_date, snoozed_until, status, source_quote, completed_at, created_at from public.tasks",
    );
    await db.asUser(userId, "select id, raw_text, source_format, has_timestamps, created_at from public.meeting_notes");
    await db.asUser(userId, "select id, title, starts_at, attendees from public.meetings");
    await db.asUser(userId, "select id, display_name from public.contacts");
    await db.asUser(userId, "select id, type, created_at from public.task_events");
    await db.asUser(userId, "select workspace_id from public.workspace_members");
    await db.asUser(userId, "select full_name, timezone, onboarding_done from public.profiles");
  });

  it("stores attendees as the array the pages expect", async () => {
    const { rows } = await db.asUser<{ attendees: string[] }>(
      userId,
      "insert into public.meetings (title, starts_at, attendees, workspace_id) values ('x', now(), $1, $2) returning attendees",
      [JSON.stringify(["Maya", "Sam"]), workspaceId],
    );
    expect(rows[0]!.attendees).toEqual(["Maya", "Sam"]);
  });
});
