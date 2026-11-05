// @vitest-environment node
//
// Runs against a real Supabase project: the signup trigger on the real auth.users,
// and RLS through the real Data API. Only for the dev and test project, never production.
//
//   npm run test:live
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_SUPABASE_URL;
const publishableKey = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.TEST_SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  throw new Error("Set TEST_SUPABASE_URL, TEST_SUPABASE_PUBLISHABLE_KEY and TEST_SUPABASE_SECRET_KEY in .env.local");
}

// A deliberate second step, so these variables can't point at production by accident.
const projectRef = new URL(url).hostname.split(".")[0];
if (process.env.VERCEL || process.env.TEST_SUPABASE_DEV_PROJECT_REF !== projectRef) {
  throw new Error("Live tests run only on the dev project. Set TEST_SUPABASE_DEV_PROJECT_REF to its project ref.");
}

const TABLES = [
  "profiles",
  "workspaces",
  "workspace_members",
  "contacts",
  "meetings",
  "meeting_notes",
  "suggestions",
  "tasks",
  "task_events",
  "integrations",
  "task_syncs",
  "reminder_prefs",
  "reminder_log",
  "ai_usage",
];

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secretKey, noPersist);
const anon = createClient(url, publishableKey, noPersist);

type TestUser = { id: string; client: SupabaseClient; workspaceId: string; meetingId: string };
const created: string[] = [];
let a: TestUser;
let b: TestUser;

async function createTestUser(label: string): Promise<TestUser> {
  const email = `followthrough-test-${label}-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  created.push(id);

  const client = createClient(url!, publishableKey!, noPersist);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  const member = await client.from("workspace_members").select("workspace_id").single();
  if (member.error) throw member.error;
  const workspaceId = member.data.workspace_id as string;

  const meeting = await client
    .from("meetings")
    .insert({ workspace_id: workspaceId, title: "Product sync", starts_at: new Date().toISOString() })
    .select("id")
    .single();
  if (meeting.error) throw meeting.error;

  return { id, client, workspaceId, meetingId: meeting.data.id as string };
}

beforeAll(async () => {
  a = await createTestUser("a");
  b = await createTestUser("b");
}, 60_000);

afterAll(async () => {
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    // Already deleted by the account deletion test.
    if (error && error.status !== 404) throw error;
  }
});

describe("signup on real Supabase", () => {
  it("creates a profile", async () => {
    const { data, error } = await a.client.from("profiles").select("id").single();
    expect(error).toBeNull();
    expect(data?.id).toBe(a.id);
  });

  it("creates a personal workspace with the user as owner", async () => {
    const { data } = await a.client.from("workspace_members").select("role, workspaces(kind)").single();
    expect(data).toEqual({ role: "owner", workspaces: { kind: "personal" } });
  });
});

describe("isolation on real Supabase", () => {
  it("hides one user's meeting from another", async () => {
    const { data } = await b.client.from("meetings").select("id").eq("id", a.meetingId);
    expect(data).toEqual([]);
  });

  it("blocks writing into another user's workspace", async () => {
    const { error } = await b.client
      .from("meetings")
      .insert({ workspace_id: a.workspaceId, title: "Intruder", starts_at: new Date().toISOString() });
    expect(error).not.toBeNull();
  });

  it("blocks changing or deleting another user's meeting", async () => {
    await b.client.from("meetings").update({ title: "Changed" }).eq("id", a.meetingId);
    await b.client.from("meetings").delete().eq("id", a.meetingId);

    const { data } = await a.client.from("meetings").select("title").eq("id", a.meetingId).single();
    expect(data?.title).toBe("Product sync");
  });

  it.each(TABLES)("gives signed-out visitors nothing from %s", async (table) => {
    const { data, error } = await anon.from(table).select("id").limit(1);
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull();
  });

  it.each(["*", "refresh_token_enc", "access_token_enc"])("never returns Google tokens to their owner with select=%s", async (columns) => {
    const { error } = await a.client.from("integrations").select(columns);
    expect(error).not.toBeNull();
  });

  it("never returns Google tokens through an embedded select", async () => {
    const { error } = await a.client.from("workspace_members").select("integrations(*)");
    expect(error).not.toBeNull();
  });

  it("blocks changing your own role", async () => {
    const { error } = await a.client.from("workspace_members").update({ role: "admin" }).eq("user_id", a.id);
    expect(error).not.toBeNull();
  });

  it.each(["handle_new_user", "is_member"])("blocks signed-out visitors from calling %s", async (name) => {
    const { error } = await anon.rpc(name, name === "is_member" ? { ws: a.workspaceId } : {});
    expect(error).not.toBeNull();
  });
});

describe("account deletion on real Supabase", () => {
  it("removes the user's data", async () => {
    const leaving = await createTestUser("leaving");
    await admin.auth.admin.deleteUser(leaving.id);

    const { data } = await admin.from("workspaces").select("id").eq("id", leaving.workspaceId);
    expect(data).toEqual([]);
  });
});
