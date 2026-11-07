// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/test-db";

let db: TestDb;
type Person = { userId: string; workspaceId: string; noteId: string; meetingId: string };
let maya: Person;
let other: Person;

const NOTES = "14:32 Sam: Maya, can you send the revised launch brief by Thursday?\n14:35 Priya: I'll update the pricing page.";
const QUOTE = "Maya, can you send the revised launch brief by Thursday?";
const START = NOTES.indexOf(QUOTE);

function item(overrides: Record<string, unknown> = {}) {
  return {
    title: "Send revised launch brief",
    owner_name: "Maya",
    due_date: "2026-10-22",
    due_date_basis: "by Thursday",
    source_quote: QUOTE,
    source_locator: { type: "timestamp", value: "14:32", start: START, end: START + QUOTE.length },
    confidence: "high",
    open_questions: [],
    ...overrides,
  };
}

async function person(email: string, notes = NOTES): Promise<Person> {
  const { userId, workspaceId } = await db.signUp(email);
  const meeting = await db.admin<{ id: string }>(
    "insert into public.meetings (workspace_id, title, starts_at) values ($1, 'Product sync', now()) returning id",
    [workspaceId],
  );
  const note = await db.asUser<{ id: string }>(
    userId,
    "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, created_by) values ($1, $2, $3, 'paste', $4) returning id",
    [meeting.rows[0]!.id, workspaceId, notes, userId],
  );
  return { userId, workspaceId, meetingId: meeting.rows[0]!.id, noteId: note.rows[0]!.id };
}

const add = (who: Person, items: unknown[], noteId = who.noteId) =>
  db.asUser<{ added: number }>(who.userId, "select public.add_suggestions($1, 'claude-test', $2) as added", [noteId, JSON.stringify(items)]);

beforeAll(async () => {
  db = await createTestDb();
  maya = await person("maya@example.com");
  other = await person("other@example.com");
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("add_suggestions", () => {
  it("stores a suggestion whose quote, owner and date wording are in the notes", async () => {
    const { rows } = await add(maya, [item()]);
    expect(rows[0]!.added).toBe(1);
  });

  it.each([
    ["a paraphrased quote", { source_quote: "Maya will send the brief by Thursday." }],
    ["offsets pointing elsewhere", { source_locator: { type: "offset", start: 0, end: QUOTE.length } }],
    ["offsets past the end", { source_locator: { type: "offset", start: START, end: NOTES.length + 5 } }],
    ["an owner not in the notes", { owner_name: "Jordan" }],
    ["an owner that is only part of a word", { owner_name: "pri" }],
    ["date wording not in the notes", { due_date_basis: "by next Monday" }],
    ["a date with no wording behind it", { due_date_basis: null }],
    ["a date that isn't real", { due_date: "2026-02-30" }],
    ["open questions that aren't text", { open_questions: [{ text: "x" }] }],
    ["more than three open questions", { open_questions: ["a", "b", "c", "d"] }],
    ["a made-up timestamp", { source_locator: { type: "timestamp", value: "<b>", start: START, end: START + QUOTE.length } }],
    ["an unknown confidence", { confidence: "certain" }],
    ["a title that is too short", { title: "Do" }],
  ])("skips %s and keeps the rest", async (_name, overrides) => {
    const { rows } = await add(maya, [item(overrides), item({ title: "Kept one" })]);
    expect(rows[0]!.added).toBe(1);
    const titles = await db.admin<{ title: string }>("select title from public.suggestions where note_id = $1 and status = 'pending'", [maya.noteId]);
    expect(titles.rows).toEqual([{ title: "Kept one" }]);
  });

  it("stores the locator it checked, not extra keys from the caller", async () => {
    const extra = { type: "timestamp", value: "14:32", start: START, end: START + QUOTE.length, line: 1, sneaky: "x".repeat(1000) };
    await add(maya, [item({ source_locator: extra })]);
    const { rows } = await db.admin<{ locator: Record<string, unknown> }>(
      "select source_locator as locator from public.suggestions where note_id = $1 and status = 'pending'",
      [maya.noteId],
    );
    expect(rows[0]!.locator).toEqual({ type: "timestamp", value: "14:32", start: START, end: START + QUOTE.length, line: 1 });
  });

  it("counts offsets in characters, so emoji before the quote don't break it", async () => {
    const who = await person("emoji@example.com", `🚀 Launch 🎉\n${NOTES}`);
    const raw = `🚀 Launch 🎉\n${NOTES}`;
    const start = Array.from(raw.slice(0, raw.indexOf(QUOTE))).length;
    const { rows } = await add(who, [item({ source_locator: { type: "offset", start, end: start + QUOTE.length } })]);
    expect(rows[0]!.added).toBe(1);
  });

  it("doesn't bring back words already confirmed or dismissed on a new run", async () => {
    const who = await person("rerun@example.com");
    await add(who, [item()]);
    const first = await db.admin<{ id: string }>("select id from public.suggestions where note_id = $1", [who.noteId]);
    await db.asUser(who.userId, "select public.confirm_suggestion($1, 'Send', 'none', null, null)", [first.rows[0]!.id]);

    const { rows } = await add(who, [item(), item({ title: "Update pricing page", owner_name: null, due_date: null, due_date_basis: null, source_quote: "I'll update the pricing page.", source_locator: { type: "offset", start: NOTES.indexOf("I'll"), end: NOTES.length } })]);

    expect(rows[0]!.added).toBe(1);
    const pending = await db.admin<{ title: string }>("select title from public.suggestions where note_id = $1 and status = 'pending'", [who.noteId]);
    expect(pending.rows).toEqual([{ title: "Update pricing page" }]);
  });

  it("refuses more than 30 at once", async () => {
    await expect(add(maya, Array.from({ length: 31 }, () => item()))).rejects.toThrow(/too many/);
  });

  it("refuses another user's notes", async () => {
    await expect(add(other, [item()], maya.noteId)).rejects.toThrow(/not found/);
  });

  it("replaces pending suggestions on a new run, but keeps decided ones", async () => {
    const priya = "I'll update the pricing page.";
    const priyaItem = (title: string) =>
      item({ title, owner_name: null, due_date: null, due_date_basis: null, source_quote: priya, source_locator: { type: "offset", start: NOTES.indexOf(priya), end: NOTES.length } });
    await add(maya, [item({ title: "First" }), item({ title: "Second" })]);
    const first = await db.admin<{ id: string }>("select id from public.suggestions where note_id = $1 and title = 'Second'", [maya.noteId]);
    await db.asUser(maya.userId, "update public.suggestions set status = 'dismissed' where id = $1", [first.rows[0]!.id]);

    await add(maya, [priyaItem("Third")]);

    const { rows } = await db.admin<{ title: string; status: string }>(
      "select title, status from public.suggestions where note_id = $1 order by title",
      [maya.noteId],
    );
    expect(rows).toEqual([
      { title: "Second", status: "dismissed" },
      { title: "Third", status: "pending" },
    ]);
  });

  it("can't be called by someone signed out", async () => {
    await expect(db.asAnon("select public.add_suggestions($1, 'x', '[]')", [maya.noteId])).rejects.toThrow(/permission denied/);
  });
});

describe("confirm_suggestion", () => {
  // Each test gets new notes, since decided words don't come back on the same notes.
  async function fresh(who: Person) {
    const note = await db.asUser<{ id: string }>(
      who.userId,
      "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, created_by) values ($1, $2, $3, 'paste', $4) returning id",
      [who.meetingId, who.workspaceId, NOTES, who.userId],
    );
    const noteId = note.rows[0]!.id;
    await add(who, [item()], noteId);
    const { rows } = await db.admin<{ id: string }>("select id from public.suggestions where note_id = $1 and status = 'pending'", [noteId]);
    return rows[0]!.id;
  }

  it("creates a task with the verified quote copied across", async () => {
    const suggestionId = await fresh(maya);
    const { rows } = await db.asUser<{ task: string }>(
      maya.userId,
      "select public.confirm_suggestion($1, 'Send the launch brief', 'me', null, '2026-10-22') as task",
      [suggestionId],
    );
    const task = await db.admin<Record<string, unknown>>(
      "select title, owner_user_id, due_date::text as due, source_quote, meeting_id, suggestion_id from public.tasks where id = $1",
      [rows[0]!.task],
    );
    expect(task.rows[0]).toEqual({
      title: "Send the launch brief",
      owner_user_id: maya.userId,
      due: "2026-10-22",
      source_quote: QUOTE,
      meeting_id: maya.meetingId,
      suggestion_id: suggestionId,
    });
    const status = await db.admin<{ status: string }>("select status from public.suggestions where id = $1", [suggestionId]);
    expect(status.rows[0]!.status).toBe("confirmed");
    const events = await db.admin("select type from public.task_events where task_id = $1", [rows[0]!.task]);
    expect(events.rows).toEqual([{ type: "created" }]);
  });

  it("returns the same task when confirmed twice", async () => {
    const suggestionId = await fresh(maya);
    const confirm = () =>
      db.asUser<{ task: string }>(maya.userId, "select public.confirm_suggestion($1, 'x', 'none', null, null) as task", [suggestionId]);
    const first = await confirm();
    const second = await confirm();
    expect(second.rows[0]!.task).toBe(first.rows[0]!.task);
    const count = await db.admin<{ n: number }>("select count(*)::int as n from public.tasks where suggestion_id = $1", [suggestionId]);
    expect(count.rows[0]!.n).toBe(1);
  });

  it("gives the task to a named person, reusing their contact", async () => {
    await db.asUser(maya.userId, "insert into public.contacts (workspace_id, display_name) values ($1, 'Priya')", [maya.workspaceId]);
    const suggestionId = await fresh(maya);
    const { rows } = await db.asUser<{ task: string }>(
      maya.userId,
      "select public.confirm_suggestion($1, 'Update pricing', 'other', 'priya', null) as task",
      [suggestionId],
    );
    const task = await db.admin<{ name: string }>(
      "select c.display_name as name from public.tasks t join public.contacts c on c.id = t.owner_contact_id where t.id = $1",
      [rows[0]!.task],
    );
    expect(task.rows[0]!.name).toBe("Priya");
  });

  it("refuses another user's suggestion", async () => {
    const suggestionId = await fresh(maya);
    await expect(
      db.asUser(other.userId, "select public.confirm_suggestion($1, 'x', 'none', null, null)", [suggestionId]),
    ).rejects.toThrow(/not found/);
  });

  it("refuses a dismissed suggestion", async () => {
    const suggestionId = await fresh(maya);
    await db.asUser(maya.userId, "update public.suggestions set status = 'dismissed' where id = $1", [suggestionId]);
    await expect(
      db.asUser(maya.userId, "select public.confirm_suggestion($1, 'x', 'none', null, null)", [suggestionId]),
    ).rejects.toThrow(/dismissed/);
  });

  it("refuses an owner choice it doesn't know", async () => {
    const suggestionId = await fresh(maya);
    await expect(
      db.asUser(maya.userId, "select public.confirm_suggestion($1, 'x', 'boss', null, null)", [suggestionId]),
    ).rejects.toThrow(/unknown owner/);
  });
});

describe("ai usage", () => {
  const reserve = (who: Person, estimate = 0.2, cap = 5, hourly = 10, globalCap: number | null = null) =>
    db.asUser<{ r: { id: string; token: string } }>(
      who.userId,
      "select public.reserve_ai_usage($1, 'claude-test', $2, $3, $4, $5) as r",
      [who.noteId, estimate, cap, hourly, globalCap],
    );
  const settle = (who: Person, id: string, token: string, cost = 0.01) =>
    db.asUser(who.userId, "select public.settle_ai_usage($1, $2, 'claude-test', 100, 50, $3)", [id, token, cost]);

  it("can't be written directly", async () => {
    await expect(
      db.asUser(maya.userId, "insert into public.ai_usage (user_id, model, cost_usd) values ($1, 'claude-test', 0)", [maya.userId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("charges the reserved cost, then the real one once settled with its token", async () => {
    const who = await person("usage@example.com");
    const { rows } = await reserve(who, 0.3);
    const { id, token } = rows[0]!.r;
    const before = await db.admin<{ cost: string }>("select cost_usd::text as cost from public.ai_usage where id = $1", [id]);
    expect(before.rows[0]!.cost).toBe("0.300000");

    await settle(who, id, token, 0.02);
    const after = await db.admin<{ cost: string; input: number }>("select cost_usd::text as cost, input_tokens as input from public.ai_usage where id = $1", [id]);
    expect(after.rows[0]).toEqual({ cost: "0.020000", input: 100 });

    // A token works once.
    await expect(settle(who, id, token, 0)).rejects.toThrow(/usage not open/);
  });

  it("refuses to settle without the token, or someone else's usage", async () => {
    const who = await person("token@example.com");
    const { id, token } = (await reserve(who)).rows[0]!.r;
    await expect(settle(who, id, "00000000-0000-4000-8000-000000000000", 0)).rejects.toThrow(/usage not open/);
    await expect(settle(other, id, token, 0)).rejects.toThrow(/usage not open/);
  });

  it("never shows the token to the user", async () => {
    await expect(db.asUser(maya.userId, "select settle_token from public.ai_usage")).rejects.toThrow(/permission denied/);
  });

  it("stops at the hourly limit, counting runs that are still going", async () => {
    const who = await person("hourly@example.com");
    await reserve(who, 0.01, 5, 2);
    await reserve(who, 0.01, 5, 2);
    await expect(reserve(who, 0.01, 5, 2)).rejects.toThrow(/ai_hourly_limit/);
  });

  it("stops at the monthly cap, counting reserved costs", async () => {
    const who = await person("monthly@example.com");
    await reserve(who, 0.6, 1);
    await reserve(who, 0.6, 1);
    await expect(reserve(who, 0.6, 1)).rejects.toThrow(/ai_monthly_cap/);
  });

  it("stops at the shared cap when one is set", async () => {
    const who = await person("global@example.com");
    await expect(reserve(who, 0.01, 5, 10, 0)).rejects.toThrow(/ai_global_cap/);
  });

  it("only reserves against notes the user can see, and refuses negative costs", async () => {
    await expect(
      db.asUser(other.userId, "select public.reserve_ai_usage($1, 'claude-test', 0.1, 5, 10, null)", [maya.noteId]),
    ).rejects.toThrow(/not found/);
    await expect(reserve(maya, -1)).rejects.toThrow(/bad usage values/);
  });
});

describe("note limits", () => {
  it("stops more than 60 new notes an hour", async () => {
    const who = await person("busy@example.com");
    for (let i = 0; i < 59; i++) {
      await db.asUser(
        who.userId,
        "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, created_by) values ($1, $2, 'x', 'paste', $3)",
        [who.meetingId, who.workspaceId, who.userId],
      );
    }
    await expect(
      db.asUser(
        who.userId,
        "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, created_by) values ($1, $2, 'x', 'paste', $3)",
        [who.meetingId, who.workspaceId, who.userId],
      ),
    ).rejects.toThrow(/note_rate_limit/);
  });

  it("stops a workspace storing more than 5 million characters", async () => {
    const who = await person("full@example.com");
    await db.admin("alter table public.meeting_notes disable trigger enforce_note_limits");
    for (let i = 0; i < 50; i++) {
      await db.admin(
        "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, created_by) values ($1, $2, $3, 'paste', null)",
        [who.meetingId, who.workspaceId, "x".repeat(100_000)],
      );
    }
    await db.admin("alter table public.meeting_notes enable trigger enforce_note_limits");
    await expect(
      db.asUser(
        who.userId,
        "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, created_by) values ($1, $2, 'x', 'paste', $3)",
        [who.meetingId, who.workspaceId, who.userId],
      ),
    ).rejects.toThrow(/note_storage_limit/);
  });
});
