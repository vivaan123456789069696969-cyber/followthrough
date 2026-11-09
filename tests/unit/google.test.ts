// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { decryptToken, encryptToken } = await import("@/lib/crypto/tokens");
const { authorizeUrl, newOAuthState, parseState, refreshAccessToken, serializeState, stateMatches } = await import("@/lib/google/oauth");
const { ContainerGone, googleFetch, GoogleError, plainError, ReconnectNeeded } = await import("@/lib/google/http");
const { middayInZone } = await import("@/lib/tasks/dates");
const { MAX_ATTEMPTS, nextAttemptAt, planSync } = await import("@/lib/google/plan");
const { deadlineEventId, deleteEvent, listEvents, upsertDeadline, upsertTask } = await import("@/lib/google/api");
const { SCOPES } = await import("@/lib/google/config");

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = randomBytes(32).toString("base64");
  process.env.GOOGLE_TEST_ENDPOINTS = "true";
  process.env.GOOGLE_API_URL = "https://google.test";
  process.env.GOOGLE_TOKEN_URL = "https://google.test/token";
});

/** A stand-in for fetch that answers from a list and remembers each request. */
function fakeFetch(...replies: (Response | (() => Response))[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    let body: unknown = init?.body;
    if (typeof body === "string" && body.startsWith("{")) body = JSON.parse(body);
    calls.push({ url: String(url), method: init?.method ?? "GET", body });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    return typeof next === "function" ? next() : next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("token encryption", () => {
  it("round-trips, with a different result each time", () => {
    const a = encryptToken("1//refresh", "google:u1:refresh");
    const b = encryptToken("1//refresh", "google:u1:refresh");
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh");
    expect(decryptToken(a, "google:u1:refresh")).toBe("1//refresh");
  });

  it("refuses a token moved to another person or kind", () => {
    const sealed = encryptToken("1//refresh", "google:u1:refresh");
    expect(() => decryptToken(sealed, "google:u2:refresh")).toThrow();
    expect(() => decryptToken(sealed, "google:u1:access")).toThrow();
  });

  it("refuses a changed token", () => {
    const sealed = encryptToken("1//refresh", "google:u1:refresh");
    const parts = sealed.split(".");
    const tampered = [...parts.slice(0, 3), Buffer.from("x").toString("base64url") + parts[3]!.slice(2)].join(".");
    expect(() => decryptToken(tampered, "google:u1:refresh")).toThrow();
  });

  it("refuses a shortened authentication tag", () => {
    const [version, iv, tag, ciphertext] = encryptToken("1//refresh", "google:u1:refresh").split(".");
    const short = Buffer.from(tag!, "base64url").subarray(0, 4).toString("base64url");
    expect(() => decryptToken([version, iv, short, ciphertext].join("."), "google:u1:refresh")).toThrow();
  });

  it("won't run without a proper key", () => {
    const saved = process.env.TOKEN_ENC_KEY;
    process.env.TOKEN_ENC_KEY = Buffer.from("short").toString("base64");
    expect(() => encryptToken("x", "c")).toThrow(/32 random bytes/);
    process.env.TOKEN_ENC_KEY = saved;
  });
});

describe("connecting", () => {
  it("asks for one feature's permission, offline, with PKCE", () => {
    const state = newOAuthState("calendar", "user-1");
    const url = new URL(authorizeUrl({ clientId: "client", redirectUri: "https://app.test/api/google/callback" }, state));
    expect(url.searchParams.get("scope")).toBe(SCOPES.calendar);
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(state.verifier).digest("base64url"));
    expect(url.searchParams.get("state")).toBe(state.state);
  });

  it("accepts the reply only for the same person, the same request, within ten minutes", () => {
    const state = newOAuthState("tasks", "user-1");
    const saved = parseState(serializeState(state));
    expect(stateMatches(saved, state.state, "user-1")).toBe(true);
    expect(stateMatches(saved, state.state, "user-2")).toBe(false);
    expect(stateMatches(saved, "forged", "user-1")).toBe(false);
    expect(stateMatches(null, state.state, "user-1")).toBe(false);
    expect(stateMatches({ ...state, createdAt: Date.now() - 11 * 60_000 }, state.state, "user-1")).toBe(false);
    expect(parseState("not-json")).toBeNull();
    // A changed cookie with a bad feature or time is refused, not trusted.
    expect(parseState(serializeState({ ...state, feature: "everything" as never }))).toBeNull();
    expect(parseState(serializeState({ ...state, createdAt: "soon" as never }))).toBeNull();
  });

  it("turns a dead refresh token into a reconnect request", async () => {
    const { impl } = fakeFetch(json(400, { error: "invalid_grant" }));
    await expect(refreshAccessToken({ clientId: "c", clientSecret: "s", redirectUri: "r" }, "1//old", impl)).rejects.toBeInstanceOf(ReconnectNeeded);
  });
});

describe("Google's addresses", () => {
  it("can't be moved without the test switch", async () => {
    const { googleUrls } = await import("@/lib/google/config");
    process.env.GOOGLE_TEST_ENDPOINTS = "";
    expect(googleUrls().token).toBe("https://oauth2.googleapis.com/token");
    expect(googleUrls().api).toBe("https://www.googleapis.com");
    process.env.GOOGLE_TEST_ENDPOINTS = "true";
    expect(googleUrls().token).toBe("https://google.test/token");
  });
});

describe("calls to Google", () => {
  it("waits and tries again when Google is busy, honouring Retry-After", async () => {
    const waits: number[] = [];
    const { impl, calls } = fakeFetch(json(429, {}, { "retry-after": "2" }), json(503, {}), json(200, { ok: true }));
    const response = await googleFetch("https://google.test/x", { fetchImpl: impl, sleep: async (ms) => void waits.push(ms) });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(waits[0]).toBe(2000);
  });

  it("gives up after the retries and reports it plainly", async () => {
    const { impl } = fakeFetch(json(503, {}), json(503, {}), json(503, { error: { errors: [{ reason: "backendError" }] } }));
    const response = await googleFetch("https://google.test/x", { fetchImpl: impl, sleep: async () => {} });
    expect(response.status).toBe(503);
    expect(plainError(new GoogleError(503, "backendError"))).toBe("Google is busy. This will be tried again.");
    // Once automatic tries are used up, it says so instead of promising another.
    expect(plainError(new GoogleError(503, "backendError"), false)).toBe("Google is busy. Sending stopped after several tries. Press Retry.");
  });

  it("lists events but leaves out cancelled ones", async () => {
    const { impl, calls } = fakeFetch(json(200, { items: [{ id: "a", status: "confirmed" }, { id: "b", status: "cancelled" }] }));
    const { events, more } = await listEvents("token", { timeMin: "2030-01-01T00:00:00Z", timeMax: "2030-01-29T00:00:00Z" }, impl);
    expect(events.map((event) => event.id)).toEqual(["a"]);
    expect(more).toBe(false);
    expect(calls[0]!.url).toContain("singleEvents=true");
    expect(calls[0]!.url).toContain("eventTypes=default");
  });

  const TASK = "0b9a8c2e-1f3d-4e5a-9b7c-6d5e4f3a2b1c";
  const EVENT = deadlineEventId(TASK);
  const notFound = () => json(404, { error: { errors: [{ reason: "notFound" }] } });

  it("gives each task's event a fixed id Google accepts", () => {
    expect(EVENT).toBe("ft0b9a8c2e1f3d4e5a9b7c6d5e4f3a2b1c");
    expect(EVENT).toMatch(/^[0-9a-v]{5,1024}$/);
  });

  it("writes due dates as all-day events, ending the next day, across a year end", async () => {
    const { impl, calls } = fakeFetch(notFound(), json(200, { id: EVENT }));
    const id = await upsertDeadline("token", "cal", null, { taskId: TASK, title: "File taxes", dueDate: "2030-12-31", description: "d" }, impl);
    expect(id).toBe(EVENT);
    expect(calls.map((call) => call.method)).toEqual(["PATCH", "POST"]);
    expect(calls[1]!.body).toMatchObject({
      id: EVENT,
      summary: "Due: File taxes",
      start: { date: "2030-12-31" },
      end: { date: "2031-01-01" },
      status: "confirmed",
    });
  });

  it("updates the existing event when an earlier try already made it", async () => {
    const { impl, calls } = fakeFetch(json(200, { id: EVENT }));
    await upsertDeadline("token", "cal", null, { taskId: TASK, title: "x", dueDate: "2030-01-01", description: "d" }, impl);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(`/events/${EVENT}`);
  });

  it("never creates twice, even if the reply to the first create was lost", async () => {
    const { impl, calls } = fakeFetch(notFound(), json(409, { error: { errors: [{ reason: "duplicate" }] } }), json(200, { id: EVENT }));
    const id = await upsertDeadline("token", "cal", null, { taskId: TASK, title: "x", dueDate: "2030-01-01", description: "d" }, impl);
    expect(id).toBe(EVENT);
    expect(calls.map((call) => call.method)).toEqual(["PATCH", "POST", "PATCH"]);
  });

  it("doesn't retry a create on its own, and reports a deleted calendar", async () => {
    const { impl, calls } = fakeFetch(notFound(), notFound());
    await expect(upsertDeadline("token", "cal", null, { taskId: TASK, title: "x", dueDate: "2030-01-01", description: "d" }, impl)).rejects.toBeInstanceOf(
      ContainerGone,
    );
    expect(calls).toHaveLength(2);
  });

  it("treats an already-deleted event as deleted", async () => {
    const { impl } = fakeFetch(new Response(null, { status: 410 }));
    await expect(deleteEvent("token", "cal", "ev", impl)).resolves.toBeUndefined();
  });

  it("sends tasks with a date-only due and finds an earlier copy by its link", async () => {
    const { impl, calls } = fakeFetch(json(200, { items: [{ id: "g1", notes: "Open in FollowThrough: x/my-day?task=t1" }] }), json(200, { id: "g1" }));
    const id = await upsertTask(
      "token",
      "list",
      null,
      { title: "Book venue", notes: "n", dueDate: "2030-05-02", done: true, marker: "/my-day?task=t1" },
      { lookForEarlier: true },
      impl,
    );
    expect(id).toBe("g1");
    expect(calls[1]!.body).toEqual({ title: "Book venue", notes: "n", due: "2030-05-02T00:00:00.000Z", status: "completed" });
  });
});

describe("all-day events", () => {
  it("become meetings at midday in the person's own timezone, on the right day", () => {
    expect(middayInZone("2030-11-10", "America/New_York")).toBe("2030-11-10T17:00:00.000Z");
    expect(middayInZone("2030-11-10", "Pacific/Honolulu")).toBe("2030-11-10T22:00:00.000Z");
    expect(middayInZone("2030-11-10", "Asia/Kolkata")).toBe("2030-11-10T06:30:00.000Z");
    expect(middayInZone("2030-07-04", "Pacific/Kiritimati")).toBe("2030-07-03T22:00:00.000Z");
  });
});

describe("what to sync", () => {
  const connected = (scopes: string[], extra: Partial<{ calendarId: string; tasklistId: string }> = {}) => ({
    status: "active",
    scopes,
    calendarId: extra.calendarId ?? null,
    tasklistId: extra.tasklistId ?? null,
  });
  const open = { id: "t1", status: "open" as const, dueDate: "2030-01-01" };

  it("does nothing without a working connection", () => {
    expect(planSync(open, null, "google_tasks", {})).toEqual([]);
    expect(planSync(open, { ...connected([SCOPES.tasks], { tasklistId: "l" }), status: "needs_reconnect" }, "google_tasks", {})).toEqual([]);
  });

  it("sends to Google Tasks only when it's the destination and a list is chosen", () => {
    const tasks = connected([SCOPES.tasks], { tasklistId: "l" });
    expect(planSync(open, tasks, "google_tasks", {})).toEqual([{ provider: "google_tasks", action: "upsert" }]);
    expect(planSync(open, tasks, "app", {})).toEqual([]);
    expect(planSync(open, connected([SCOPES.tasks]), "google_tasks", {})).toEqual([]);
  });

  it("completes a dismissed task already sent, and skips one never sent", () => {
    const tasks = connected([SCOPES.tasks], { tasklistId: "l" });
    const dismissed = { ...open, status: "dismissed" as const };
    expect(planSync(dismissed, tasks, "google_tasks", {})).toEqual([]);
    expect(planSync(dismissed, tasks, "google_tasks", { tasks: { provider: "google_tasks", externalId: "g1" } })).toEqual([
      { provider: "google_tasks", action: "upsert" },
    ]);
  });

  it("doesn't send a task already done, but completes one already sent", () => {
    const tasks = connected([SCOPES.tasks], { tasklistId: "l" });
    const done = { ...open, status: "done" as const };
    expect(planSync(done, tasks, "google_tasks", {})).toEqual([]);
    expect(planSync(done, tasks, "google_tasks", { tasks: { provider: "google_tasks", externalId: "g1" } })).toEqual([
      { provider: "google_tasks", action: "upsert" },
    ]);
  });

  it("keeps a due-date event only while the task is open and dated", () => {
    const deadlines = connected([SCOPES.deadlines], { calendarId: "c" });
    const sent = { calendar: { provider: "google_calendar" as const, externalId: "ev1" } };
    expect(planSync(open, deadlines, null, {})).toEqual([{ provider: "google_calendar", action: "upsert" }]);
    expect(planSync({ ...open, status: "done" }, deadlines, null, sent)).toEqual([{ provider: "google_calendar", action: "delete", externalId: "ev1" }]);
    expect(planSync({ ...open, dueDate: null }, deadlines, null, sent)).toEqual([{ provider: "google_calendar", action: "delete", externalId: "ev1" }]);
    expect(planSync({ ...open, dueDate: null }, deadlines, null, {})).toEqual([]);
  });

  it("waits longer after each failure, then stops for the user's Retry", () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    expect(nextAttemptAt(1, now)).toBe("2030-01-01T00:01:00.000Z");
    expect(nextAttemptAt(3, now)).toBe("2030-01-01T00:04:00.000Z");
    expect(nextAttemptAt(MAX_ATTEMPTS, now)).toBeNull();
  });
});
