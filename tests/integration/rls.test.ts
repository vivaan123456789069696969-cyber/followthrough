// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/test-db";

type Person = { userId: string; workspaceId: string };
type Seeded = Person & Record<string, string>;

let db: TestDb;
let a: Seeded;
let b: Seeded;

const LOCATOR = '{"type":"offset","start":0,"end":5}';

/** One row in every table for this person. Written as admin. */
async function seed(person: Person): Promise<Seeded> {
  const { userId, workspaceId } = person;
  const one = async (sql: string, params: unknown[]) => {
    const { rows } = await db.admin<{ id: string }>(`${sql} returning id`, params);
    return rows[0]!.id;
  };

  const contact = await one("insert into public.contacts (workspace_id, display_name) values ($1, 'Sam')", [workspaceId]);
  const meeting = await one(
    "insert into public.meetings (workspace_id, title, starts_at) values ($1, 'Product sync', now())",
    [workspaceId],
  );
  const note = await one(
    "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, content_hash, created_by) values ($1, $2, 'Maya, send it', 'paste', 'hash', $3)",
    [meeting, workspaceId, userId],
  );
  const suggestion = await one(
    `insert into public.suggestions (note_id, workspace_id, title, source_quote, source_locator, confidence, model)
     values ($1, $2, 'Send it', 'Maya, send it', '${LOCATOR}', 'high', 'test')`,
    [note, workspaceId],
  );
  const task = await one("insert into public.tasks (workspace_id, title, created_by) values ($1, 'Send it', $2)", [
    workspaceId,
    userId,
  ]);
  const taskEvent = await one(
    "insert into public.task_events (task_id, workspace_id, actor_id, type) values ($1, $2, $3, 'created')",
    [task, workspaceId, userId],
  );
  const integration = await one(
    "insert into public.integrations (workspace_id, user_id, provider, access_token_enc, refresh_token_enc) values ($1, $2, 'google', 'enc-a', 'enc-r')",
    [workspaceId, userId],
  );
  const taskSync = await one("insert into public.task_syncs (task_id, workspace_id, provider) values ($1, $2, 'google_tasks')", [
    task,
    workspaceId,
  ]);
  const reminderPrefs = await one("insert into public.reminder_prefs (user_id) values ($1)", [userId]);
  const reminderLog = await one(
    "insert into public.reminder_log (task_id, user_id, kind, scheduled_for) values ($1, $2, 'due_today', now())",
    [task, userId],
  );
  const aiUsage = await one("insert into public.ai_usage (user_id, note_id, model) values ($1, $2, 'test')", [userId, note]);
  const member = await db.admin<{ id: string }>("select id from public.workspace_members where user_id = $1", [userId]);

  return {
    ...person,
    profiles: userId,
    workspaces: workspaceId,
    workspace_members: member.rows[0]!.id,
    contacts: contact,
    meetings: meeting,
    meeting_notes: note,
    suggestions: suggestion,
    tasks: task,
    task_events: taskEvent,
    integrations: integration,
    task_syncs: taskSync,
    reminder_prefs: reminderPrefs,
    reminder_log: reminderLog,
    ai_usage: aiUsage,
  };
}

/** One update per table, used to test who is allowed to run it. */
const updates: Record<string, string> = {
  profiles: "full_name = 'changed'",
  workspaces: "name = 'changed'",
  workspace_members: "role = 'owner'",
  contacts: "display_name = 'changed'",
  meetings: "title = 'changed'",
  meeting_notes: "has_timestamps = true",
  suggestions: "title = 'changed'",
  tasks: "title = 'changed'",
  task_events: "type = 'edited'",
  integrations: "status = 'revoked'",
  task_syncs: "state = 'failed'",
  reminder_prefs: "enabled = true",
  reminder_log: "kind = 'changed'",
  ai_usage: "cost_usd = 0",
};

/** Attempts to create a row inside `target`'s data. */
const inserts: Record<string, (target: Seeded) => [string, unknown[]]> = {
  profiles: (t) => ["insert into public.profiles (id) values ($1)", [t.userId]],
  workspaces: (t) => ["insert into public.workspaces (name, created_by) values ('x', $1)", [t.userId]],
  workspace_members: (t) => ["insert into public.workspace_members (workspace_id, user_id) values ($1, $2)", [t.workspaceId, t.userId]],
  contacts: (t) => ["insert into public.contacts (workspace_id, display_name) values ($1, 'x')", [t.workspaceId]],
  meetings: (t) => ["insert into public.meetings (workspace_id, title, starts_at) values ($1, 'x', now())", [t.workspaceId]],
  meeting_notes: (t) => [
    "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, content_hash, created_by) values ($1, $2, 'x', 'paste', 'h', $3)",
    [t.meetings, t.workspaceId, t.userId],
  ],
  suggestions: (t) => [
    `insert into public.suggestions (note_id, workspace_id, title, source_quote, source_locator, confidence, model) values ($1, $2, 'Send', 'x', '${LOCATOR}', 'high', 'test')`,
    [t.meeting_notes, t.workspaceId],
  ],
  tasks: (t) => ["insert into public.tasks (workspace_id, title, created_by) values ($1, 'x', $2)", [t.workspaceId, t.userId]],
  task_events: (t) => [
    "insert into public.task_events (task_id, workspace_id, actor_id, type) values ($1, $2, $3, 'edited')",
    [t.tasks, t.workspaceId, t.userId],
  ],
  integrations: (t) => [
    "insert into public.integrations (workspace_id, user_id, provider) values ($1, $2, 'google')",
    [t.workspaceId, t.userId],
  ],
  task_syncs: (t) => [
    "insert into public.task_syncs (task_id, workspace_id, provider) values ($1, $2, 'google_calendar')",
    [t.tasks, t.workspaceId],
  ],
  reminder_prefs: (t) => ["insert into public.reminder_prefs (user_id) values ($1)", [t.userId]],
  reminder_log: (t) => [
    "insert into public.reminder_log (task_id, user_id, kind, scheduled_for) values ($1, $2, 'x', now())",
    [t.tasks, t.userId],
  ],
  ai_usage: (t) => ["insert into public.ai_usage (user_id, model) values ($1, 'x')", [t.userId]],
};

const TABLES = Object.keys(updates);

/** What a signed-in user may do to their own rows. Everything else is server-only. */
const ownAccess: Record<string, { insert: boolean; update: boolean; delete: boolean }> = {
  profiles: { insert: false, update: true, delete: false },
  workspaces: { insert: false, update: true, delete: false },
  workspace_members: { insert: false, update: false, delete: false },
  contacts: { insert: true, update: true, delete: true },
  meetings: { insert: true, update: true, delete: true },
  meeting_notes: { insert: true, update: false, delete: true },
  suggestions: { insert: false, update: true, delete: true },
  tasks: { insert: true, update: true, delete: true },
  task_events: { insert: true, update: false, delete: false },
  integrations: { insert: false, update: false, delete: false },
  task_syncs: { insert: false, update: false, delete: false },
  reminder_prefs: { insert: true, update: true, delete: false },
  reminder_log: { insert: false, update: false, delete: false },
  ai_usage: { insert: false, update: false, delete: false },
};

async function rowExistsUnchanged(table: string, id: string, before: unknown) {
  const { rows } = await db.admin(`select * from public.${table} where id = $1`, [id]);
  expect(rows[0]).toEqual(before);
}

beforeAll(async () => {
  db = await createTestDb();
  a = await seed(await db.signUp("a@example.com", { full_name: "Maya Chen", avatar_url: "https://example.com/a.png" }));
  b = await seed(await db.signUp("b@example.com"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("test coverage", () => {
  it("covers every table in the public schema", async () => {
    const { rows } = await db.admin<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
    expect(rows.map((row) => row.tablename).sort()).toEqual([...TABLES].sort());
  });

  it("has RLS on and at least one policy on every table", async () => {
    const { rows } = await db.admin<{ relname: string; relrowsecurity: boolean; policies: number }>(`
      select c.relname, c.relrowsecurity, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);
    expect(rows).toHaveLength(TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} RLS`).toBe(true);
      expect(row.policies, `${row.relname} policies`).toBeGreaterThan(0);
    }
  });

  it("has no policy that allows everything", async () => {
    const { rows } = await db.admin<{ policyname: string }>(
      "select policyname from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true')",
    );
    expect(rows).toEqual([]);
  });
});

describe("signup", () => {
  it("creates a profile from the sign-in details", async () => {
    const { rows } = await db.admin<{ full_name: string; avatar_url: string; timezone: string | null }>(
      "select full_name, avatar_url, timezone from public.profiles where id = $1",
      [a.userId],
    );
    expect(rows[0]).toEqual({ full_name: "Maya Chen", avatar_url: "https://example.com/a.png", timezone: null });
  });

  it("creates a personal workspace with the user as owner", async () => {
    const { rows } = await db.admin<{ kind: string; role: string }>(
      `select w.kind, m.role from public.workspaces w join public.workspace_members m on m.workspace_id = w.id where m.user_id = $1`,
      [a.userId],
    );
    expect(rows).toEqual([{ kind: "personal", role: "owner" }]);
  });

  it("works with no name in the sign-in details, as with magic links", async () => {
    const { rows } = await db.admin<{ full_name: string | null }>("select full_name from public.profiles where id = $1", [b.userId]);
    expect(rows[0]!.full_name).toBeNull();
  });
});

describe.each(TABLES)("%s", (table) => {
  it("lets a user read their own row", async () => {
    const { rows } = await db.asUser<{ id: string }>(a.userId, `select id from public.${table} where id = $1`, [a[table]]);
    expect(rows).toEqual([{ id: a[table] }]);
  });

  it("hides another user's row", async () => {
    const { rows } = await db.asUser(b.userId, `select id from public.${table} where id = $1`, [a[table]]);
    expect(rows).toEqual([]);
  });

  it("returns only the user's own rows when listing", async () => {
    const { rows } = await db.asUser<{ id: string }>(b.userId, `select id from public.${table}`);
    expect(rows.map((row) => row.id)).not.toContain(a[table]);
    expect(rows.map((row) => row.id)).toContain(b[table]);
  });

  it("blocks creating a row in another user's data", async () => {
    const [sql, params] = inserts[table]!(a);
    await expect(db.asUser(b.userId, sql, params)).rejects.toThrow();
  });

  it("blocks updating another user's row", async () => {
    const before = (await db.admin(`select * from public.${table} where id = $1`, [a[table]])).rows[0];
    const attempt = await db
      .asUser(b.userId, `update public.${table} set ${updates[table]} where id = $1`, [a[table]])
      .catch(() => ({ affectedRows: 0 }));
    expect(attempt.affectedRows).toBe(0);
    await rowExistsUnchanged(table, a[table]!, before);
  });

  it("blocks deleting another user's row", async () => {
    const before = (await db.admin(`select * from public.${table} where id = $1`, [a[table]])).rows[0];
    const attempt = await db
      .asUser(b.userId, `delete from public.${table} where id = $1`, [a[table]])
      .catch(() => ({ affectedRows: 0 }));
    expect(attempt.affectedRows).toBe(0);
    await rowExistsUnchanged(table, a[table]!, before);
  });

  it("gives someone signed out nothing", async () => {
    await expect(db.asAnon(`select id from public.${table}`)).rejects.toThrow(/permission denied/);
    const [sql, params] = inserts[table]!(a);
    await expect(db.asAnon(sql, params)).rejects.toThrow(/permission denied/);
    await expect(db.asAnon(`update public.${table} set ${updates[table]}`)).rejects.toThrow(/permission denied/);
    await expect(db.asAnon(`delete from public.${table}`)).rejects.toThrow(/permission denied/);
  });

  it("allows or blocks the user's own writes as designed", async () => {
    const access = ownAccess[table]!;
    const person = await seed(await db.signUp(`${table}@example.com`));

    const update = db.asUser(person.userId, `update public.${table} set ${updates[table]} where id = $1`, [person[table]]);
    if (access.update) {
      expect((await update).affectedRows).toBe(1);
    } else {
      await expect(update).rejects.toThrow(/permission denied/);
    }

    const removal = db.asUser(person.userId, `delete from public.${table} where id = $1`, [person[table]]);
    if (access.delete) {
      expect((await removal).affectedRows).toBe(1);
    } else {
      await expect(removal).rejects.toThrow(/permission denied/);
    }

    const insertPerson = await seed(await db.signUp(`${table}-insert@example.com`));
    if (table === "reminder_prefs") {
      await db.admin("delete from public.reminder_prefs where user_id = $1", [insertPerson.userId]);
    }
    const [sql, params] = inserts[table]!(insertPerson);
    if (access.insert) {
      expect((await db.asUser(insertPerson.userId, sql, params)).affectedRows).toBe(1);
    } else {
      await expect(db.asUser(insertPerson.userId, sql, params)).rejects.toThrow(/permission denied/);
    }
  });
});

describe("attacks across workspaces", () => {
  it("blocks joining another workspace", async () => {
    await expect(
      db.asUser(b.userId, "insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [
        a.workspaceId,
        b.userId,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("blocks moving your membership into another workspace", async () => {
    await expect(
      db.asUser(b.userId, "update public.workspace_members set workspace_id = $1 where user_id = $2", [a.workspaceId, b.userId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("blocks attaching notes in your workspace to another user's meeting", async () => {
    await expect(
      db.asUser(
        b.userId,
        "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, content_hash, created_by) values ($1, $2, 'x', 'paste', 'h', $3)",
        [a.meetings, b.workspaceId, b.userId],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it.each([
    ["meeting", "meeting_id", "meetings"],
    ["suggestion", "suggestion_id", "suggestions"],
    ["contact", "owner_contact_id", "contacts"],
  ])("blocks a task in your workspace pointing at another user's %s", async (_name, column, source) => {
    await expect(
      db.asUser(b.userId, `insert into public.tasks (workspace_id, title, created_by, ${column}) values ($1, 'x', $2, $3)`, [
        b.workspaceId,
        b.userId,
        a[source],
      ]),
    ).rejects.toThrow(/foreign key/);
  });

  it("blocks assigning a task to someone outside the workspace", async () => {
    await expect(
      db.asUser(b.userId, "insert into public.tasks (workspace_id, title, created_by, owner_user_id) values ($1, 'x', $2, $3)", [
        b.workspaceId,
        b.userId,
        a.userId,
      ]),
    ).rejects.toThrow(/foreign key/);
  });

  it("blocks moving your row into another workspace", async () => {
    await expect(
      db.asUser(b.userId, "update public.tasks set workspace_id = $1 where id = $2", [a.workspaceId, b.tasks]),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["tasks", "insert into public.tasks (workspace_id, title, created_by) values ($1, 'x', $2)"],
    ["task_events", "insert into public.task_events (task_id, workspace_id, actor_id, type) values ($3, $1, $2, 'edited')"],
  ])("blocks signing a row with someone else's name (%s)", async (_name, sql) => {
    const params = sql.includes("$3") ? [b.workspaceId, a.userId, b.tasks] : [b.workspaceId, a.userId];
    await expect(db.asUser(b.userId, sql, params)).rejects.toThrow(/row-level security/);
  });

  it("does not let a user call the signup function", async () => {
    await expect(db.asUser(b.userId, "select public.handle_new_user()")).rejects.toThrow();
    await expect(db.asAnon("select public.is_member($1)", [a.workspaceId])).rejects.toThrow(/permission denied/);
  });

  it("answers membership checks only about the caller", async () => {
    const { rows } = await db.asUser<{ yes: boolean }>(b.userId, "select public.is_member($1) as yes", [a.workspaceId]);
    expect(rows[0]!.yes).toBe(false);
  });
});

describe("sensitive columns", () => {
  it.each(["access_token_enc", "refresh_token_enc"])("hides %s from the owner too", async (column) => {
    await expect(db.asUser(a.userId, `select ${column} from public.integrations where id = $1`, [a.integrations])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("blocks select * on integrations, so tokens can't leak by accident", async () => {
    await expect(db.asUser(a.userId, "select * from public.integrations")).rejects.toThrow(/permission denied/);
  });

  it("still lets the owner read the connection status", async () => {
    const { rows } = await db.asUser<{ status: string }>(a.userId, "select status from public.integrations where id = $1", [a.integrations]);
    expect(rows).toEqual([{ status: "active" }]);
  });

  it("hides the unsubscribe token from clients", async () => {
    await expect(db.asUser(a.userId, "select unsubscribe_token from public.reminder_prefs")).rejects.toThrow(/permission denied/);
  });

  it("blocks linking a contact to a real user from the client", async () => {
    await expect(
      db.asUser(a.userId, "update public.contacts set linked_user_id = $1 where id = $2", [b.userId, a.contacts]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("original notes", () => {
  it("can't be changed by a client", async () => {
    await expect(
      db.asUser(a.userId, "update public.meeting_notes set raw_text = 'edited' where id = $1", [a.meeting_notes]),
    ).rejects.toThrow(/permission denied/);
  });

  it("can't be changed even by the server", async () => {
    await expect(db.admin("update public.meeting_notes set raw_text = 'edited' where id = $1", [a.meeting_notes])).rejects.toThrow(/immutable/);
  });

  it("rejects notes over the size cap", async () => {
    await expect(
      db.asUser(
        a.userId,
        "insert into public.meeting_notes (meeting_id, workspace_id, raw_text, source_format, content_hash, created_by) values ($1, $2, $3, 'paste', 'h', $4)",
        [a.meetings, a.workspaceId, "x".repeat(100_001), a.userId],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("account deletion", () => {
  it("removes all of a user's data and leaves other users alone", async () => {
    const person = await seed(await db.signUp("leaving@example.com"));
    const others = await seed(await db.signUp("staying@example.com"));

    await db.admin("delete from auth.users where id = $1", [person.userId]);

    for (const table of TABLES) {
      const gone = await db.admin(`select id from public.${table} where id = $1`, [person[table]]);
      expect(gone.rows, `${table} left behind`).toEqual([]);
      const kept = await db.admin(`select id from public.${table} where id = $1`, [others[table]]);
      expect(kept.rows, `${table} of another user`).toHaveLength(1);
    }
  });

  it("keeps a task when its meeting is deleted, so commitments aren't lost", async () => {
    const person = await seed(await db.signUp("meeting-delete@example.com"));
    const { rows } = await db.admin<{ id: string }>(
      "insert into public.tasks (workspace_id, title, meeting_id, created_by, source_quote) values ($1, 'Keep me', $2, $3, 'quote') returning id",
      [person.workspaceId, person.meetings, person.userId],
    );

    await db.asUser(person.userId, "delete from public.meetings where id = $1", [person.meetings]);

    const task = await db.admin<{ meeting_id: string | null; workspace_id: string; source_quote: string }>(
      "select meeting_id, workspace_id, source_quote from public.tasks where id = $1",
      [rows[0]!.id],
    );
    expect(task.rows[0]).toEqual({ meeting_id: null, workspace_id: person.workspaceId, source_quote: "quote" });
  });
});
