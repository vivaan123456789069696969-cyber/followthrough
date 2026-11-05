// A tiny stand-in for Supabase, so browser tests can reach the signed-in pages with
// no credentials. Tokens are checked by name, the way the real /auth/v1/user endpoint
// checks signatures. Only "good-*" tokens are valid.
import { createServer } from "node:http";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const savedTimezones = [];

function tokenOf(request) {
  const header = request.headers.authorization ?? "";
  const signature = header.split(".")[2] ?? "";
  return signature;
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

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const token = tokenOf(request);
  const valid = token.startsWith("good-");

  if (url.pathname === "/health") return send(response, 200, { ok: true });
  if (url.pathname === "/test/timezones") return send(response, 200, savedTimezones);

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

    if (url.pathname === "/rest/v1/profiles" && request.method === "PATCH") {
      const body = await readBody(request);
      savedTimezones.push(body.timezone);
      return send(response, 204);
    }
    if (url.pathname === "/rest/v1/profiles") {
      if (token === "good-no-profile") return send(response, 200, []);
      if (token === "good-has-timezone") return send(response, 200, [{ full_name: "Maya Chen", timezone: "UTC", onboarding_done: false }]);
      return send(response, 200, [{ full_name: "Maya Chen", timezone: null, onboarding_done: false }]);
    }
    if (url.pathname === "/rest/v1/workspaces") return send(response, 200, [{ name: "Personal" }]);
  }

  return send(response, 404, { message: "not found" });
}).listen(54399, "127.0.0.1");
