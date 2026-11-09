// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/test-db";

let db: TestDb;

const NOTES = "14:32 Sam: Maya, can you send the revised launch brief by Thursday?";
const QUOTE = "Maya, can you send the revised launch brief by Thursday?";
const START = NOTES.indexOf(QUOTE);

type Person = { userId: string; workspaceId: string; meetingId: string; noteId: string; taskId: string };

/** A person with a meeting, notes, a confirmed task from those notes, and a manual task. */
async function person(email: string): Promise<Person> {
  const { userId, workspaceId } = await db.signUp(email);
  const meeting = await db.asUser<{ id: string }>(
    userId,
    "insert into public.meetings (workspace_id, title, starts_at) values ($1, 'Product sync', now()) returning id",
    [workspaceId],
  );
  const meetingId = meeting.rows[0]!.id;
  const note = await db.asUser<{ id: string }>(
    userId,
    "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, created_by) values ($1, $2, $3, 'paste', $4) returning id",
    [meetingId, workspaceId, NOTES, userId],
  );
  const noteId = note.rows[0]!.id;
  const item = {
    title: "Send revised launch brief",
    owner_name: "Maya",
    due_date: null,
    due_date_basis: null,
    source_quote: QUOTE,
    source_locator: { type: "timestamp", value: "14:32", start: START, end: START + QUOTE.length, line: 1 },
    confidence: "high",
    open_questions: [],
  };
  await db.asUser(userId, "select public.add_suggestions($1, 'claude-test', $2)", [noteId, JSON.stringify([item])]);
  const suggestion = await db.admin<{ id: string }>("select id from public.suggestions where note_id = $1", [noteId]);
  const task = await db.asUser<{ id: string }>(userId, "select public.confirm_suggestion($1, 'Send the brief', 'me', null, null) as id", [
    suggestion.rows[0]!.id,
  ]);
  await db.asUser(userId, "insert into public.tasks (workspace_id, title, created_by) values ($1, 'Manual task', $2)", [workspaceId, userId]);
  await db.asUser(userId, "insert into public.contacts (workspace_id, display_name) values ($1, 'Priya')", [workspaceId]);
  return { userId, workspaceId, meetingId, noteId, taskId: task.rows[0]!.id };
}

const count = async (sql: string, params: unknown[]) => (await db.admin<{ n: number }>(sql, params)).rows[0]!.n;

/** Everything left anywhere that belongs to this person. */
async function leftovers(who: Person) {
  const byWorkspace = ["workspace_members", "contacts", "meetings", "meeting_notes", "suggestions", "tasks", "task_events"];
  const counts: Record<string, number> = {
    auth_users: await count("select count(*)::int as n from auth.users where id = $1", [who.userId]),
    profiles: await count("select count(*)::int as n from public.profiles where id = $1", [who.userId]),
    workspaces: await count("select count(*)::int as n from public.workspaces where id = $1", [who.workspaceId]),
    ai_usage: await count("select count(*)::int as n from public.ai_usage where user_id = $1", [who.userId]),
  };
  for (const table of byWorkspace) {
    counts[table] = await count(`select count(*)::int as n from public.${table} where workspace_id = $1`, [who.workspaceId]);
  }
  return counts;
}

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("delete_my_account", () => {
  it("removes every row the person owns, and nobody else's", async () => {
    const maya = await person("maya@example.com");
    const other = await person("other@example.com");
    const usage = await db.asServer<{ r: { id: string } }>("select public.reserve_ai_usage($1, $2, 'claude-test', 0.1, 5, 10, null) as r", [
      maya.userId,
      maya.noteId,
    ]);

    const before = await leftovers(maya);
    expect(Object.values(before).every((n) => n > 0)).toBe(true);

    await db.asUser(maya.userId, "select public.delete_my_account()");

    const after = await leftovers(maya);
    expect(Object.values(after).every((n) => n === 0), JSON.stringify(after)).toBe(true);
    // Spend stays counted, with nothing left to say whose it was.
    const kept = await db.admin("select user_id, note_id, cost_usd::text as cost from public.ai_usage where id = $1", [usage.rows[0]!.r.id]);
    expect(kept.rows).toEqual([{ user_id: null, note_id: null, cost: "0.100000" }]);
    const untouched = await leftovers(other);
    expect(untouched.tasks).toBe(2);
    expect(untouched.meeting_notes).toBe(1);
  });

  it("can't be called signed out", async () => {
    await expect(db.asAnon("select public.delete_my_account()")).rejects.toThrow(/permission denied/);
  });

  it("refuses while the person created a shared workspace others are in", async () => {
    const owner = await person("team-owner@example.com");
    const member = await person("team-member@example.com");
    const team = await db.admin<{ id: string }>("insert into public.workspaces (name, kind, created_by) values ('Team', 'team', $1) returning id", [owner.userId]);
    await db.admin("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')", [
      team.rows[0]!.id,
      owner.userId,
      member.userId,
    ]);

    await expect(db.asUser(owner.userId, "select public.delete_my_account()")).rejects.toThrow(/transfer_ownership_first/);
    expect(await count("select count(*)::int as n from public.workspaces where id = $1", [team.rows[0]!.id])).toBe(1);
  });
});

describe("purge_expired_notes", () => {
  it("deletes only notes older than their creator's setting, and tasks keep their quote", async () => {
    const short = await person("short@example.com");
    const keep = await person("keep@example.com");
    await db.asUser(short.userId, "update public.profiles set note_retention_days = 30 where id = $1", [short.userId]);
    // Both people's notes are 40 days old. Only one of them chose to delete after 30.
    await db.admin("alter table public.meeting_notes disable trigger user");
    await db.admin("update public.meeting_notes set created_at = now() - interval '40 days' where id = any($1)", [[short.noteId, keep.noteId]]);
    await db.admin("alter table public.meeting_notes enable trigger user");

    const { rows } = await db.admin<{ removed: number }>("select public.purge_expired_notes() as removed");

    expect(rows[0]!.removed).toBe(1);
    expect(await count("select count(*)::int as n from public.meeting_notes where id = $1", [short.noteId])).toBe(0);
    expect(await count("select count(*)::int as n from public.meeting_notes where id = $1", [keep.noteId])).toBe(1);
    const task = await db.admin<{ source_quote: string }>("select source_quote from public.tasks where id = $1", [short.taskId]);
    expect(task.rows[0]!.source_quote).toBe(QUOTE);
  });

  it("leaves notes in shared workspaces alone", async () => {
    const who = await person("shared-notes@example.com");
    const team = await db.admin<{ id: string }>("insert into public.workspaces (name, kind, created_by) values ('Team', 'team', $1) returning id", [who.userId]);
    await db.admin("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [team.rows[0]!.id, who.userId]);
    const meeting = await db.admin<{ id: string }>("insert into public.meetings (workspace_id, title, starts_at) values ($1, 'Team sync', now()) returning id", [
      team.rows[0]!.id,
    ]);
    const note = await db.admin<{ id: string }>(
      "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, created_by, created_at) values ($1, $2, 'x', 'paste', $3, now() - interval '40 days') returning id",
      [meeting.rows[0]!.id, team.rows[0]!.id, who.userId],
    );
    await db.asUser(who.userId, "update public.profiles set note_retention_days = 30 where id = $1", [who.userId]);

    await db.admin("select public.purge_expired_notes()");

    expect(await count("select count(*)::int as n from public.meeting_notes where id = $1", [note.rows[0]!.id])).toBe(1);
  });

  it("leaves newer notes alone", async () => {
    const fresh = await person("fresh@example.com");
    await db.asUser(fresh.userId, "update public.profiles set note_retention_days = 30 where id = $1", [fresh.userId]);
    await db.admin("select public.purge_expired_notes()");
    expect(await count("select count(*)::int as n from public.meeting_notes where id = $1", [fresh.noteId])).toBe(1);
  });

  it("can't be run by users", async () => {
    const who = await person("caller@example.com");
    await expect(db.asUser(who.userId, "select public.purge_expired_notes()")).rejects.toThrow(/permission denied/);
    await expect(db.asAnon("select public.purge_expired_notes()")).rejects.toThrow(/permission denied/);
  });
});

describe("setup and settings choices", () => {
  it("lets a person save their own choices", async () => {
    const who = await person("choices@example.com");
    await db.asUser(who.userId, "update public.profiles set task_destination = 'google_tasks', onboarding_done = true, note_retention_days = 365 where id = $1", [
      who.userId,
    ]);
    const { rows } = await db.admin("select task_destination, onboarding_done, note_retention_days from public.profiles where id = $1", [who.userId]);
    expect(rows[0]).toEqual({ task_destination: "google_tasks", onboarding_done: true, note_retention_days: 365 });
  });

  it.each([
    ["an unknown destination", "task_destination = 'slack'"],
    ["keeping notes for more than ten years", "note_retention_days = 4000"],
    ["a retention of zero days", "note_retention_days = 0"],
  ])("refuses %s", async (_name, change) => {
    const who = await person(`refuse-${Math.random().toString(36).slice(2)}@example.com`);
    await expect(db.asUser(who.userId, `update public.profiles set ${change} where id = $1`, [who.userId])).rejects.toThrow(/check constraint/);
  });

  it("can't change someone else's choices", async () => {
    const a = await person("a-choices@example.com");
    const b = await person("b-choices@example.com");
    await db.asUser(a.userId, "update public.profiles set task_destination = 'app' where id = $1", [b.userId]);
    const { rows } = await db.admin<{ task_destination: string | null }>("select task_destination from public.profiles where id = $1", [b.userId]);
    expect(rows[0]!.task_destination).toBeNull();
  });
});
