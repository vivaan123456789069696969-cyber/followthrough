// A tiny stand-in for Supabase, so browser tests and the demo can reach the signed-in
// pages with no credentials. Tokens are checked by name, the way the real /auth/v1/user
// endpoint checks signatures: only "good-*" tokens are valid. Each token gets its own
// data, as if it were its own workspace. RLS itself is tested on real Postgres in
// tests/integration/rls.test.ts.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const savedTimezones = [];
const stores = new Map();

function storeFor(token) {
  if (!stores.has(token)) {
    stores.set(token, {
      timezone: token.startsWith("good-utc") ? "UTC" : null,
      fullName: "Maya Chen",
      workspaceId: randomUUID(),
      tables: { contacts: [], meetings: [], meeting_notes: [], tasks: [], task_events: [] },
    });
  }
  return stores.get(token);
}

function tokenOf(request) {
  return (request.headers.authorization ?? "").split(".")[2] ?? "";
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body === undefined ? "" : JSON.stringify(body));
}

async function readBody(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}

const RESERVED = new Set(["select", "order", "limit", "offset", "columns"]);

function matches(row, params) {
  for (const [column, condition] of params) {
    if (RESERVED.has(column)) continue;
    const [operator, ...rest] = condition.split(".");
    const value = rest.join(".");
    if (operator === "eq" && String(row[column]) !== value) return false;
    if (operator === "is" && value === "null" && row[column] !== null && row[column] !== undefined) return false;
    if (operator === "in" && !value.slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, "")).includes(String(row[column]))) return false;
  }
  return true;
}

function ordered(rows, params) {
  const order = params.get("order");
  if (!order) return rows;
  const [column, direction] = order.split(",")[0].split(".");
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => (a[column] === b[column] ? 0 : a[column] > b[column] ? sign : -sign));
}

function reply(request, response, status, rows) {
  if ((request.headers.accept ?? "").includes("vnd.pgrst.object")) {
    if (rows.length !== 1) return send(response, 406, { code: "PGRST116", message: "not one row" });
    return send(response, status, rows[0]);
  }
  return send(response, status, rows);
}

const DEFAULTS = {
  tasks: { meeting_id: null, suggestion_id: null, description: null, owner_user_id: null, owner_contact_id: null, due_date: null, snoozed_until: null, status: "open", source_quote: null, completed_at: null },
  meetings: { attendees: [], external_event_id: null },
};

function addRow(table, row) {
  const now = new Date().toISOString();
  return { id: randomUUID(), created_at: now, updated_at: now, ...DEFAULTS[table], ...row };
}

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const token = tokenOf(request);
  const valid = token.startsWith("good-");

  if (url.pathname === "/health") return send(response, 200, { ok: true });
  if (url.pathname === "/test/timezones") return send(response, 200, savedTimezones);
  if (url.pathname === "/test/profile") {
    const { token: profileToken, full_name: fullName } = await readBody(request);
    storeFor(profileToken).fullName = fullName;
    return send(response, 200, { ok: true });
  }
  if (url.pathname === "/test/seed") {
    const { token: seedToken, table, rows } = await readBody(request);
    const store = storeFor(seedToken);
    const added = rows.map((row) => addRow(table, { workspace_id: store.workspaceId, ...row }));
    store.tables[table].push(...added);
    return send(response, 200, added);
  }

  if (url.pathname === "/auth/v1/user") {
    if (!valid) return send(response, 403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    return send(response, 200, { id: USER_ID, aud: "authenticated", role: "authenticated", email: "maya@example.com" });
  }

  if (url.pathname === "/auth/v1/logout") return send(response, 204);

  if (url.pathname === "/auth/v1/otp") {
    const body = await readBody(request);
    if (body.email === "fail@example.com") return send(response, 500, { code: 500, msg: "failed" });
    if (body.email === "busy@example.com") return send(response, 429, { code: 429, error_code: "over_email_send_rate_limit", msg: "slow down" });
    return send(response, 200, {});
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    if (!valid) return send(response, 401, { message: "JWT invalid" });
    if (token === "good-db-down") return send(response, 500, { message: "database down" });
    const store = storeFor(token);
    const table = url.pathname.slice("/rest/v1/".length);

    if (table === "profiles" && request.method === "PATCH") {
      const body = await readBody(request);
      savedTimezones.push(body.timezone);
      store.timezone = body.timezone;
      return send(response, 204);
    }
    if (table === "profiles") {
      if (token === "good-no-profile") return send(response, 200, []);
      return send(response, 200, [{ full_name: store.fullName, timezone: store.timezone, onboarding_done: false }]);
    }
    if (table === "workspaces") return send(response, 200, [{ name: "Personal" }]);
    if (table === "workspace_members") return send(response, 200, [{ workspace_id: store.workspaceId }]);

    const rows = store.tables[table];
    if (!rows) return send(response, 404, { message: "no such table" });

    if (request.method === "GET") {
      let found = ordered(rows.filter((row) => matches(row, url.searchParams)), url.searchParams);
      const limit = Number(url.searchParams.get("limit"));
      if (limit) found = found.slice(0, limit);
      return reply(request, response, 200, found);
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      const added = (Array.isArray(body) ? body : [body]).map((row) => addRow(table, row));
      rows.push(...added);
      return (request.headers.prefer ?? "").includes("return=representation")
        ? reply(request, response, 201, added)
        : send(response, 201);
    }
    if (request.method === "PATCH") {
      const body = await readBody(request);
      const found = rows.filter((row) => matches(row, url.searchParams));
      found.forEach((row) => Object.assign(row, body, { updated_at: new Date().toISOString() }));
      if ((request.headers.prefer ?? "").includes("return=representation")) {
        if ((request.headers.accept ?? "").includes("vnd.pgrst.object")) return reply(request, response, 200, found);
        return send(response, 200, found);
      }
      return send(response, 204);
    }
    if (request.method === "DELETE") {
      const keep = rows.filter((row) => !matches(row, url.searchParams));
      store.tables[table] = keep;
      if (table === "meetings") {
        const ids = new Set(keep.map((row) => row.id));
        store.tables.meeting_notes = store.tables.meeting_notes.filter((note) => ids.has(note.meeting_id));
        store.tables.tasks.forEach((task) => {
          if (task.meeting_id && !ids.has(task.meeting_id)) task.meeting_id = null;
        });
      }
      return send(response, 204);
    }
  }

  return send(response, 404, { message: "not found" });
}).listen(54399, "127.0.0.1");
