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
      // "good-new*" people haven't been through setup yet. Everyone else has.
      settings: { onboarding_done: !token.startsWith("good-new"), note_retention_days: null, task_destination: null },
      workspaceId: randomUUID(),
      tables: { contacts: [], meetings: [], meeting_notes: [], tasks: [], task_events: [], suggestions: [], ai_usage: [], reminder_prefs: [], integrations: [], task_syncs: [], reminder_log: [] },
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
    if (operator === "ilike") {
      const wanted = decodeURIComponent(value).replace(/\\(.)/g, "$1").toLowerCase();
      if (String(row[column]).toLowerCase() !== wanted) return false;
    }
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
  if (url.pathname === "/test/state") {
    const { token: stateToken } = await readBody(request);
    const store = storeFor(stateToken);
    return send(response, 200, { deleted: Boolean(store.deleted), settings: store.settings, fullName: store.fullName, timezone: store.timezone });
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

  if (url.pathname === "/auth/v1/verify") {
    const body = await readBody(request);
    if (body.token_hash !== "good-token") return send(response, 403, { code: 403, error_code: "otp_expired", msg: "expired" });
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "maya@example.com" };
    // "good-confirm" is 12 characters, a valid base64url length.
    const accessToken = [encode({ alg: "HS256", typ: "JWT" }), encode({ sub: USER_ID, role: "authenticated", exp: expires }), "good-confirm"].join(".");
    return send(response, 200, { access_token: accessToken, refresh_token: "refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user });
  }

  if (url.pathname === "/auth/v1/otp") {
    const body = await readBody(request);
    if (body.email === "fail@example.com") return send(response, 500, { code: 500, msg: "failed" });
    if (body.email === "busy@example.com") return send(response, 429, { code: 429, error_code: "over_email_send_rate_limit", msg: "slow down" });
    return send(response, 200, {});
  }

  // A stand-in for the Claude API. It "finds" commitments with simple rules, and adds
  // one invented quote when the notes ask for it, so the app's checks can be seen working.
  if (url.pathname === "/v1/messages") {
    const body = await readBody(request);
    const text = body.messages[0].content;
    const notes = text.slice(text.indexOf("<meeting_notes>") + 16, text.lastIndexOf("</meeting_notes>")).trim();
    const actions = [];
    // Browsers send textarea text with \r\n line breaks.
    for (const line of notes.split(/\r?\n/)) {
      const sentence = line.replace(/^\s*(\d{1,2}:\d{2}\s+)?[\p{L} ]{1,30}:\s*/u, "");
      const commitment = /(can you|will|I'll)\s+(.+?)[.?]?$/i.exec(sentence);
      if (!commitment) continue;
      const owner = /^([A-Z][a-z]+)(,| will)/.exec(sentence)?.[1] ?? null;
      const due = /\b(by [A-Za-z]+|tomorrow|today)\b/i.exec(sentence)?.[0] ?? null;
      const task = commitment[2].replace(/\s+(by [A-Za-z]+|tomorrow|today)\b.*$/i, "");
      actions.push({ title: task.charAt(0).toUpperCase() + task.slice(1), owner_name: owner, due_phrase: due, source_quote: sentence, confidence: "high", open_questions: [] });
    }
    if (notes.includes("FABRICATE")) {
      actions.push({ title: "Wire money", owner_name: "Maya", due_phrase: null, source_quote: "Maya will wire the money today.", confidence: "high", open_questions: [] });
    }
    return send(response, 200, {
      id: `msg_${randomUUID()}`,
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: JSON.stringify({ actions }) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 300 },
    });
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    if (!valid) return send(response, 401, { message: "JWT invalid" });
    if (token === "good-db-down") return send(response, 500, { message: "database down" });
    const store = storeFor(token);
    const table = url.pathname.slice("/rest/v1/".length);

    if (table === "profiles" && request.method === "PATCH") {
      const body = await readBody(request);
      if ("timezone" in body) {
        savedTimezones.push(body.timezone);
        store.timezone = body.timezone;
      }
      if ("full_name" in body) store.fullName = body.full_name;
      for (const key of ["onboarding_done", "note_retention_days", "task_destination"]) {
        if (key in body) store.settings[key] = body[key];
      }
      return send(response, 200, store.deleted ? [] : [{ id: USER_ID }]);
    }
    if (table === "profiles") {
      if (token === "good-no-profile" || store.deleted) return send(response, 200, []);
      return send(response, 200, [{ full_name: store.fullName, timezone: store.timezone, ...store.settings }]);
    }
    if (table === "rpc/delete_my_account") {
      store.deleted = true;
      for (const key of Object.keys(store.tables)) store.tables[key] = [];
      return send(response, 200, null);
    }
    if (table === "workspaces") return send(response, 200, [{ name: "Personal" }]);
    if (table === "workspace_members") return send(response, 200, store.deleted ? [] : [{ workspace_id: store.workspaceId }]);

    // The two database functions, with the same checks as the real ones.
    if (table === "rpc/add_suggestions") {
      const body = await readBody(request);
      const note = store.tables.meeting_notes.find((row) => row.id === body.p_note_id);
      if (!note) return send(response, 403, { message: "note not found" });
      // Offsets count characters, as Postgres does. Items that fail are skipped, as in the database.
      const characters = Array.from(note.raw_text);
      const decided = store.tables.suggestions.filter((row) => row.note_id === note.id && row.status !== "pending");
      const valid = body.p_items.filter((item) => {
        const { start, end } = item.source_locator;
        if (characters.slice(start, end).join("") !== item.source_quote) return false;
        return !decided.some((row) => row.source_locator.start < end && start < row.source_locator.end);
      });
      store.tables.suggestions = store.tables.suggestions.filter((row) => !(row.note_id === note.id && row.status === "pending"));
      store.tables.suggestions.push(
        ...valid.map((item) => addRow("suggestions", { ...item, note_id: note.id, workspace_id: store.workspaceId, status: "pending", model: body.p_model })),
      );
      return send(response, 200, valid.length);
    }
    if (table === "rpc/reserve_ai_usage") {
      const body = await readBody(request);
      const hourAgo = Date.now() - 60 * 60 * 1000;
      const recent = store.tables.ai_usage.filter((row) => Date.parse(row.created_at) > hourAgo).length;
      if (recent >= body.p_hourly_limit) return send(response, 400, { code: "P0001", message: "ai_hourly_limit" });
      const row = addRow("ai_usage", { note_id: body.p_note_id, model: body.p_model, cost_usd: body.p_estimate_usd, settle_token: randomUUID() });
      store.tables.ai_usage.push(row);
      return send(response, 200, { id: row.id, token: row.settle_token });
    }
    if (table === "rpc/settle_ai_usage") {
      const body = await readBody(request);
      const row = store.tables.ai_usage.find((usage) => usage.id === body.p_usage_id && usage.settle_token === body.p_token);
      if (!row) return send(response, 403, { message: "usage not open" });
      Object.assign(row, { settle_token: null, model: body.p_model, input_tokens: body.p_input_tokens, output_tokens: body.p_output_tokens, cost_usd: body.p_cost_usd });
      return send(response, 200, null);
    }
    if (table === "rpc/confirm_suggestion") {
      const body = await readBody(request);
      const suggestion = store.tables.suggestions.find((row) => row.id === body.p_suggestion_id);
      if (!suggestion) return send(response, 403, { message: "suggestion not found" });
      const existing = store.tables.tasks.find((row) => row.suggestion_id === suggestion.id);
      if (existing) return send(response, 200, existing.id);
      if (suggestion.status !== "pending") return send(response, 400, { message: "suggestion was dismissed" });
      let contactId = null;
      if (body.p_owner_kind === "other") {
        let contact = store.tables.contacts.find((row) => row.display_name.toLowerCase() === body.p_owner_name.toLowerCase());
        if (!contact) store.tables.contacts.push((contact = addRow("contacts", { display_name: body.p_owner_name, workspace_id: store.workspaceId })));
        contactId = contact.id;
      }
      const note = store.tables.meeting_notes.find((row) => row.id === suggestion.note_id);
      const task = addRow("tasks", {
        workspace_id: store.workspaceId,
        meeting_id: note?.meeting_id ?? null,
        suggestion_id: suggestion.id,
        title: body.p_title,
        owner_user_id: body.p_owner_kind === "me" ? USER_ID : null,
        owner_contact_id: contactId,
        due_date: body.p_due_date,
        source_quote: suggestion.source_quote,
      });
      store.tables.tasks.push(task);
      Object.assign(suggestion, { status: "confirmed" });
      return send(response, 200, task.id);
    }

    const rows = store.tables[table];
    if (!rows) return send(response, 404, { message: "no such table" });

    if (request.method === "HEAD") {
      const count = rows.filter((row) => matches(row, url.searchParams)).length;
      response.writeHead(200, { "content-range": `*/${count}` });
      return response.end();
    }

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
