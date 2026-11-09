// A tiny stand-in for Supabase, so browser tests and the demo can reach the signed-in
// pages with no credentials. Tokens are checked by name, the way the real /auth/v1/user
// endpoint checks signatures: only "good-*" tokens are valid. Each token gets its own
// data, as if it were its own workspace. RLS itself is tested on real Postgres in
// tests/integration/rls.test.ts.
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_KEY = "sb_secret_e2e_placeholder";
const savedTimezones = [];
const stores = new Map();

/** "good-gg<32 hex>" tokens are people with their own user id, for the Google tests. Everyone else shares USER_ID. */
export function userIdFor(token) {
  const match = /^good-gg([0-9a-f]{32})$/.exec(token);
  if (!match) return USER_ID;
  const h = match[1];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function storeFor(token) {
  if (!stores.has(token)) {
    stores.set(token, {
      userId: userIdFor(token),
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

/** PostgREST's or=(col.op.value,col.op.value): true if any part holds. */
function matchesAny(row, list) {
  return list
    .replace(/^\(|\)$/g, "")
    .split(",")
    .some((part) => {
      const [column, ...rest] = part.split(".");
      return matches(row, new URLSearchParams([[column, rest.join(".")]]));
    });
}

function matches(row, params) {
  for (const [column, condition] of params) {
    if (RESERVED.has(column)) continue;
    if (column === "or") {
      if (!matchesAny(row, condition)) return false;
      continue;
    }
    const [operator, ...rest] = condition.split(".");
    const value = rest.join(".");
    if (operator === "eq" && String(row[column]) !== value) return false;
    if (operator === "is" && value === "null" && row[column] !== null && row[column] !== undefined) return false;
    if (operator === "ilike") {
      const wanted = decodeURIComponent(value).replace(/\\(.)/g, "$1").toLowerCase();
      if (String(row[column]).toLowerCase() !== wanted) return false;
    }
    if (operator === "in" && !value.slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, "")).includes(String(row[column]))) return false;
    if (operator === "neq" && String(row[column]) === value) return false;
    if (operator === "lt" && !(Number(row[column]) < Number(value))) return false;
    // Timestamps compare as text, which works for ISO format.
    if (operator === "lte" && !(row[column] != null && String(row[column]) <= value)) return false;
    if (operator === "gt" && !(row[column] != null && String(row[column]) > value)) return false;
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
  // The real table's defaults, so the app sees the same shape.
  task_syncs: { external_id: null, container_id: null, state: "pending", last_error: null, last_synced_at: null, attempts: 0, next_attempt_at: null },
};

function addRow(table, row) {
  const now = new Date().toISOString();
  const extra =
    table === "reminder_prefs"
      ? { enabled: false, digest_time: "08:00", day_before: false, quiet_start: "21:00", quiet_end: "07:00", types: {}, unsubscribe_token: randomUUID() }
      : {};
  return { id: randomUUID(), created_at: now, updated_at: now, ...DEFAULTS[table], ...extra, ...row };
}

/**
 * Inserts rows, or with ?on_conflict= behaves like an upsert: existing matches are merged,
 * or skipped when the request asks to ignore duplicates. Returns the rows written.
 */
function upsertRows(rows, table, body, url, prefer) {
  const conflict = url.searchParams.get("on_conflict")?.split(",");
  const ignore = (prefer ?? "").includes("ignore-duplicates");
  const written = [];
  for (const row of Array.isArray(body) ? body : [body]) {
    const existing = conflict && rows.find((candidate) => conflict.every((column) => String(candidate[column]) === String(row[column])));
    if (existing) {
      if (ignore) continue;
      Object.assign(existing, row, { updated_at: new Date().toISOString() });
      written.push(existing);
    } else {
      const created = addRow(table, row);
      rows.push(created);
      written.push(created);
    }
  }
  return written;
}

const sentEmails = [];

// ---------------------------------------------------------------------------
// Admin access (the secret key): reads and writes across every account.
// ---------------------------------------------------------------------------

async function adminRest(request, response, url) {
  const table = url.pathname.slice("/rest/v1/".length);
  const params = url.searchParams;
  const live = [...stores.values()].filter((store) => !store.deleted);

  if (table === "profiles") {
    const id = (params.get("id") ?? "").replace(/^eq\./, "");
    const store = live.find((candidate) => candidate.userId === id);
    return reply(request, response, 200, store ? [{ id: store.userId, full_name: store.fullName, timezone: store.timezone, ...store.settings }] : []);
  }

  if (table === "workspace_members") {
    const members = live.map((store) => ({ workspace_id: store.workspaceId, user_id: store.userId, role: "owner", created_at: "2026-01-01T00:00:00Z" }));
    return reply(request, response, 200, members.filter((row) => matches(row, params)).slice(0, Number(params.get("limit")) || undefined));
  }

  const tablesOf = (store) => store.tables[table] ?? [];
  if (request.method === "GET") {
    let found = ordered(live.flatMap((store) => tablesOf(store).filter((row) => matches(row, params))), params);
    const limit = Number(params.get("limit"));
    if (limit) found = found.slice(0, limit);
    return reply(request, response, 200, found);
  }
  if (request.method === "POST") {
    const body = await readBody(request);
    const added = [];
    for (const row of Array.isArray(body) ? body : [body]) {
      // Rows find their account by workspace, or by user for per-person tables.
      const store = live.find((candidate) => candidate.workspaceId === row.workspace_id || (!row.workspace_id && candidate.userId === row.user_id));
      if (!store) return send(response, 409, { code: "23503", message: "no such workspace" });
      const rows = tablesOf(store);
      if (table === "meetings" && row.external_event_id && rows.some((meeting) => meeting.external_event_id === row.external_event_id)) {
        return send(response, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
      }
      added.push(...upsertRows(rows, table, row, url, request.headers.prefer));
    }
    return (request.headers.prefer ?? "").includes("return=representation") ? reply(request, response, 201, added) : send(response, 201);
  }
  if (request.method === "PATCH") {
    const body = await readBody(request);
    const found = live.flatMap((store) => tablesOf(store).filter((row) => matches(row, params)));
    found.forEach((row) => Object.assign(row, body, { updated_at: new Date().toISOString() }));
    return (request.headers.prefer ?? "").includes("return=representation") ? reply(request, response, 200, found) : send(response, 204);
  }
  if (request.method === "DELETE") {
    for (const store of live) if (store.tables[table]) store.tables[table] = store.tables[table].filter((row) => !matches(row, params));
    return send(response, 204);
  }
  return send(response, 405, { message: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Google, for the Phase 5 tests: sign-in with PKCE, Calendar and Tasks.
// Each browser context gets its own Google account through a cookie on this origin.
// ---------------------------------------------------------------------------

const googleAccounts = new Map();
const googleCodes = new Map();
const googleTokens = new Map(); // access or refresh token -> { account, kind }
// Failure switches, per Google account, so tests running at the same time don't share them.
const googleControls = new Map();
const controlFor = (accountId) => {
  if (!googleControls.has(accountId)) googleControls.set(accountId, { deny: false, untick: false, failWrites: 0, revokeAll: false });
  return googleControls.get(accountId);
};

function cookieOf(request, name) {
  return (request.headers.cookie ?? "").split(/;\s*/).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function googleAccount(id) {
  if (!googleAccounts.has(id)) {
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    googleAccounts.set(id, {
      id,
      scopes: new Set(),
      events: [
        {
          id: "evt-launch",
          summary: "Launch planning",
          status: "confirmed",
          start: { dateTime: soon.toISOString() },
          attendees: [{ displayName: "Maya Chen", self: true }, { displayName: "Sam Lee" }, { email: "priya@example.com" }, { email: "room-4@example.com", resource: true }],
        },
        { id: "evt-cancelled", summary: "Cancelled sync", status: "cancelled", start: { dateTime: soon.toISOString() } },
        { id: "evt-offsite", summary: "Team offsite", status: "confirmed", start: { date: "2030-11-10" }, end: { date: "2030-11-11" } },
      ],
      calendars: new Map(),
      lists: new Map([["list-default", { title: "My Tasks", tasks: new Map() }]]),
    });
  }
  return googleAccounts.get(id);
}

function issueTokens(account) {
  const access = `ya29.${randomUUID()}`;
  const refresh = `1//${randomUUID()}`;
  googleTokens.set(access, { account, kind: "access" });
  googleTokens.set(refresh, { account, kind: "refresh" });
  return { access, refresh };
}

async function google(request, response, url) {
  const path = url.pathname;

  // Test controls and inspection.
  if (path === "/test/google") {
    const { account, ...settings } = await readBody(request);
    return send(response, 200, Object.assign(controlFor(account), settings));
  }
  if (path === "/test/google-account") {
    const account = googleAccounts.get(url.searchParams.get("id"));
    if (!account) return send(response, 404, {});
    return send(response, 200, {
      scopes: [...account.scopes],
      calendars: [...account.calendars].map(([id, calendar]) => ({ id, summary: calendar.summary, events: [...calendar.events.values()] })),
      lists: [...account.lists].map(([id, list]) => ({ id, title: list.title, tasks: [...list.tasks.values()] })),
      revoked: Boolean(account.revoked),
    });
  }

  if (path === "/google/authorize") {
    const params = url.searchParams;
    let accountId = cookieOf(request, "gacct");
    const headers = {};
    if (!accountId) {
      accountId = randomUUID();
      headers["set-cookie"] = `gacct=${accountId}; Path=/; HttpOnly`;
    }
    const back = new URL(params.get("redirect_uri"));
    back.searchParams.set("state", params.get("state"));
    const control = controlFor(accountId);
    if (control.deny) {
      back.searchParams.set("error", "access_denied");
    } else {
      if (params.get("client_id") !== "e2e-client" || params.get("code_challenge_method") !== "S256") return send(response, 400, { error: "invalid_request" });
      const account = googleAccount(accountId);
      account.revoked = false;
      const requested = params.get("scope").split(" ");
      const granted = control.untick ? [] : requested;
      const code = randomUUID();
      googleCodes.set(code, { account, granted, challenge: params.get("code_challenge"), redirectUri: params.get("redirect_uri") });
      back.searchParams.set("code", code);
    }
    response.writeHead(302, { location: back.toString(), ...headers });
    return response.end();
  }

  if (path === "/google/token") {
    let text = "";
    for await (const chunk of request) text += chunk;
    const form = new URLSearchParams(text);
    if (form.get("client_secret") !== "e2e-secret") return send(response, 401, { error: "invalid_client" });
    if (form.get("grant_type") === "authorization_code") {
      const grant = googleCodes.get(form.get("code"));
      googleCodes.delete(form.get("code"));
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (!grant || grant.challenge !== challenge || grant.redirectUri !== form.get("redirect_uri")) return send(response, 400, { error: "invalid_grant" });
      grant.granted.forEach((scope) => grant.account.scopes.add(scope));
      const { access, refresh } = issueTokens(grant.account);
      // With include_granted_scopes, Google reports everything granted so far.
      return send(response, 200, { access_token: access, refresh_token: refresh, expires_in: 3600, scope: [...grant.account.scopes].join(" "), token_type: "Bearer" });
    }
    const known = googleTokens.get(form.get("refresh_token"));
    if (!known || known.kind !== "refresh" || known.account.revoked || controlFor(known.account.id).revokeAll) return send(response, 400, { error: "invalid_grant" });
    const access = `ya29.${randomUUID()}`;
    googleTokens.set(access, { account: known.account, kind: "access" });
    return send(response, 200, { access_token: access, expires_in: 3600, scope: [...known.account.scopes].join(" "), token_type: "Bearer" });
  }

  if (path === "/google/revoke") {
    let text = "";
    for await (const chunk of request) text += chunk;
    const known = googleTokens.get(new URLSearchParams(text).get("token"));
    if (!known) return send(response, 400, { error: "invalid_token" });
    known.account.revoked = true;
    known.account.scopes.clear();
    return send(response, 200, {});
  }

  if (!path.startsWith("/google/api/")) return send(response, 404, {});
  const bearer = (request.headers.authorization ?? "").replace(/^Bearer /, "");
  const known = googleTokens.get(bearer);
  if (!known || known.kind !== "access" || known.account.revoked || controlFor(known.account.id).revokeAll) {
    return send(response, 401, { error: { status: "UNAUTHENTICATED", errors: [{ reason: "authError" }] } });
  }
  const account = known.account;
  const has = (scope) => account.scopes.has(`https://www.googleapis.com/auth/${scope}`);
  const api = path.slice("/google/api".length);
  const write = request.method !== "GET";
  const control = controlFor(account.id);
  if (write && control.failWrites > 0) {
    control.failWrites -= 1;
    return send(response, 503, { error: { status: "UNAVAILABLE", errors: [{ reason: "backendError" }] } });
  }
  const body = write && request.method !== "DELETE" ? await readBody(request) : {};
  let match;

  // Calendar: the person's own events, read only.
  if ((match = /^\/calendar\/v3\/calendars\/primary\/events(?:\/([^/]+))?$/.exec(api))) {
    if (!has("calendar.events.owned.readonly")) return send(response, 403, { error: { errors: [{ reason: "insufficientPermissions" }] } });
    if (match[1]) {
      const event = account.events.find((item) => item.id === decodeURIComponent(match[1]));
      return event ? send(response, 200, event) : send(response, 404, { error: { errors: [{ reason: "notFound" }] } });
    }
    return send(response, 200, { items: account.events });
  }

  // Calendar: calendars this app made, and their events.
  if (api === "/calendar/v3/calendars" && request.method === "POST") {
    if (!has("calendar.app.created")) return send(response, 403, { error: { errors: [{ reason: "insufficientPermissions" }] } });
    const id = `cal-${randomUUID()}`;
    account.calendars.set(id, { summary: body.summary, events: new Map() });
    return send(response, 200, { id, summary: body.summary });
  }
  if ((match = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(api))) {
    const calendar = account.calendars.get(decodeURIComponent(match[1]));
    if (!has("calendar.app.created") || !calendar) return send(response, 404, { error: { errors: [{ reason: "notFound" }] } });
    const id = match[2] && decodeURIComponent(match[2]);
    if (request.method === "GET") {
      const wanted = url.searchParams.get("privateExtendedProperty")?.split("=")[1];
      return send(response, 200, { items: [...calendar.events.values()].filter((event) => event.extendedProperties?.private?.followthrough_task_id === wanted) });
    }
    if (request.method === "POST") {
      // Like Google: an id may be chosen, and choosing one that exists is refused.
      if (body.id && calendar.events.has(body.id)) return send(response, 409, { error: { errors: [{ reason: "duplicate" }] } });
      const event = { ...body, id: body.id ?? `ev-${randomUUID()}` };
      calendar.events.set(event.id, event);
      return send(response, 200, event);
    }
    if (!calendar.events.has(id)) return send(response, 404, { error: { errors: [{ reason: "notFound" }] } });
    if (request.method === "PATCH") {
      const event = Object.assign(calendar.events.get(id), body);
      return send(response, 200, event);
    }
    calendar.events.delete(id);
    response.writeHead(204);
    return response.end();
  }

  // Tasks.
  if (api.startsWith("/tasks/v1/") && !has("tasks")) return send(response, 403, { error: { errors: [{ reason: "insufficientPermissions" }] } });
  if (api === "/tasks/v1/users/@me/lists") {
    if (request.method === "POST") {
      const id = `list-${randomUUID()}`;
      account.lists.set(id, { title: body.title, tasks: new Map() });
      return send(response, 200, { id, title: body.title });
    }
    return send(response, 200, { items: [...account.lists].map(([id, list]) => ({ id, title: list.title })) });
  }
  if ((match = /^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/.exec(api))) {
    const list = account.lists.get(decodeURIComponent(match[1]));
    if (!list) return send(response, 404, { error: { errors: [{ reason: "notFound" }] } });
    const id = match[2] && decodeURIComponent(match[2]);
    if (request.method === "GET") return send(response, 200, { items: [...list.tasks.values()] });
    if (request.method === "POST") {
      const task = { ...body, id: `task-${randomUUID()}` };
      list.tasks.set(task.id, task);
      return send(response, 200, task);
    }
    if (!list.tasks.has(id)) return send(response, 404, { error: { errors: [{ reason: "notFound" }] } });
    return send(response, 200, Object.assign(list.tasks.get(id), body));
  }

  return send(response, 404, { error: { errors: [{ reason: "notFound" }] } });
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
    return send(response, 200, { id: userIdFor(token), aud: "authenticated", role: "authenticated", email: "maya@example.com" });
  }

  if (url.pathname.startsWith("/google/") || url.pathname.startsWith("/test/google")) return google(request, response, url);

  // Resend, for the reminder tests: every email is kept so tests can read it.
  if (url.pathname === "/resend/emails" && request.method === "POST") {
    if (request.headers.authorization !== "Bearer re_e2e_placeholder") return send(response, 401, { message: "bad key" });
    const email = { id: randomUUID(), ...(await readBody(request)), idempotencyKey: request.headers["idempotency-key"] };
    sentEmails.push(email);
    return send(response, 200, { id: email.id });
  }
  if (url.pathname === "/test/emails") return send(response, 200, sentEmails);

  // The admin API's user lookup, used to find where to send reminders.
  const adminUser = /^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/.exec(url.pathname);
  if (adminUser && request.headers.apikey === ADMIN_KEY) {
    const store = [...stores.values()].find((candidate) => candidate.userId === adminUser[1] && !candidate.deleted);
    if (!store) return send(response, 404, { code: 404, msg: "User not found" });
    return send(response, 200, { id: store.userId, aud: "authenticated", role: "authenticated", email: "maya@example.com" });
  }

  // The server's admin client: no session, sees every account, like Supabase's secret key.
  if (url.pathname.startsWith("/rest/v1/") && request.headers.apikey === ADMIN_KEY) return adminRest(request, response, url);

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
      return send(response, 200, store.deleted ? [] : [{ id: store.userId }]);
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
        owner_user_id: body.p_owner_kind === "me" ? store.userId : null,
        owner_contact_id: contactId,
        due_date: body.p_due_date,
        source_quote: suggestion.source_quote,
        created_by: store.userId,
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
      const added = upsertRows(rows, table, body, url, request.headers.prefer);
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
