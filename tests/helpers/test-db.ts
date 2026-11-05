import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

/**
 * The parts of Supabase the migrations rely on: its roles, auth.users and auth.uid().
 * Real Postgres runs in-process, so these tests need no Docker, keys or network.
 */
const supabaseStub = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- Supabase's default: new public tables and functions are open to these roles.
  -- The migrations must take that away themselves, so the tests start from it.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createTestDb() {
  const pg = await PGlite.create();
  await pg.exec(supabaseStub);

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await pg.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }

  /** Run as the database owner, for setup and for checking results. Bypasses RLS. */
  async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return pg.query<T>(sql, params);
  }

  async function asRole<T>(role: string, userId: string | null, sql: string, params: unknown[]) {
    await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    await pg.exec(`set role ${role}`);
    try {
      return await pg.query<T>(sql, params);
    } finally {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  }

  /** Run as a signed-in user, like the browser client. */
  async function asUser<T = Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []) {
    return asRole<T>("authenticated", userId, sql, params);
  }

  /** Run with no session. */
  async function asAnon<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return asRole<T>("anon", null, sql, params);
  }

  async function signUp(email: string, metadata: Record<string, unknown> = {}) {
    const { rows } = await admin<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
      [email, JSON.stringify(metadata)],
    );
    const userId = rows[0]!.id;
    const members = await admin<{ workspace_id: string }>(
      "select workspace_id from public.workspace_members where user_id = $1",
      [userId],
    );
    return { userId, workspaceId: members.rows[0]!.workspace_id };
  }

  return { admin, asUser, asAnon, signUp, close: () => pg.close() };
}
