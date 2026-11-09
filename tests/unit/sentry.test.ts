// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "@/lib/csp";
import { sentryOptions, sentryOrigin } from "@/lib/sentry/options";
import { safeMessage, scrubEvent } from "@/lib/sentry/scrub";

describe("what an error report may contain", () => {
  const event = {
    event_id: "abc",
    message: "Maya Chen will send the revised launch brief to maya@example.com",
    user: { id: "u1", email: "maya@example.com", ip_address: "1.2.3.4" },
    request: { url: "https://app.test/meetings?q=secret", data: "notes: Sam will fire Priya", cookies: { session: "token" }, headers: { authorization: "Bearer x" } },
    extra: { notes: "the full meeting notes" },
    contexts: { device: { name: "laptop" } },
    breadcrumbs: [{ message: "clicked Confirm task for Send revised launch brief" }],
    server_name: "host-123",
    exception: {
      values: [
        {
          type: "ZodError",
          value: '[{"message":"Invalid input","input":"Sam will book the venue by Friday"}]',
          stacktrace: { frames: [{ filename: "lib/ai/run.ts", lineno: 41, function: "runExtraction", vars: { notes: "private text" } }] },
        },
      ],
    },
  };
  const scrubbed = scrubEvent(event) as Record<string, unknown>;

  it("drops the person, the request, extra data, contexts, breadcrumbs and the server name", () => {
    for (const key of ["user", "request", "extra", "contexts", "breadcrumbs", "server_name"]) expect(scrubbed).not.toHaveProperty(key);
  });

  it("leaves nothing a person typed anywhere in the report", () => {
    const text = JSON.stringify(scrubbed);
    for (const secret of ["Maya", "maya@example.com", "Sam will", "private text", "full meeting notes", "secret", "Bearer", "Priya", "1.2.3.4"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("keeps what's needed to find the bug: the error type and where it happened", () => {
    expect(scrubbed.exception).toEqual({
      values: [
        {
          type: "ZodError",
          value: "[redacted]",
          stacktrace: { frames: [{ filename: "lib/ai/run.ts", function: "runExtraction", lineno: 41 }] },
        },
      ],
    });
  });

  it("rebuilds the report from a few safe parts, so unknown fields never get through", () => {
    const report = scrubEvent({
      event_id: "abc",
      level: "error",
      tags: { note: "Sam will fire Priya" },
      transaction: "/meetings/Sam will fire Priya",
      fingerprint: ["Sam will fire Priya"],
      spans: [{ description: "Sam will fire Priya" }],
      threads: { values: [{ name: "Sam will fire Priya" }] },
      sdk: { name: "x" },
    }) as Record<string, unknown>;
    expect(Object.keys(report).sort()).toEqual(["event_id", "level"]);
  });

  it("keeps the app's own error codes, and redacts anything else", () => {
    expect(safeMessage("integration_load_failed:42P01")).toBe("integration_load_failed:42P01");
    expect(safeMessage("google_503_backendError")).toBe("google_503_backendError");
    expect(safeMessage("Unexpected token 'S', \"Sam will bo\"... is not valid JSON")).toBe("[redacted]");
    expect(safeMessage("sam@example.com")).toBe("[redacted]");
    // A short title or phrase from notes has spaces, so it never passes.
    expect(safeMessage("Send revised launch brief")).toBe("[redacted]");
    expect(safeMessage("Priya")).toBe("Priya");
    expect(safeMessage("a".repeat(81))).toBe("[redacted]");
    expect(safeMessage(undefined)).toBe("[redacted]");
  });
});

describe("turning reporting on and off", () => {
  it("is off without a key: nothing is sent", () => {
    expect(sentryOptions(undefined)).toMatchObject({ enabled: false, dsn: undefined });
    expect(sentryOptions("")).toMatchObject({ enabled: false });
  });

  it("with a key, sends no performance data, no breadcrumbs and no personal data", () => {
    expect(sentryOptions("https://key@o1.ingest.sentry.io/2")).toMatchObject({
      enabled: true,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
    });
  });

  it("sends no performance data at all", () => {
    expect(sentryOptions("https://key@o1.ingest.sentry.io/2").beforeSendTransaction()).toBeNull();
  });

  it("runs every report through the scrubber before it leaves", () => {
    const report = sentryOptions("https://key@o1.ingest.sentry.io/2").beforeSend({ message: "sam@example.com", user: { id: "1" } });
    expect(report).toEqual({ message: "[redacted]" });
  });
});

describe("the browser security policy and error reporting", () => {
  const connect = (policy: string) => policy.split("; ").find((part) => part.startsWith("connect-src"));

  it("allows only the app itself while reporting is off", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    expect(connect(contentSecurityPolicy("nonce", false))).toBe("connect-src 'self'");
  });

  it("adds just Sentry's address, without the key, when reporting is on", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://publickey@o1.ingest.sentry.io/2";
    const policy = contentSecurityPolicy("nonce", false);
    expect(connect(policy)).toBe("connect-src 'self' https://o1.ingest.sentry.io");
    expect(policy).not.toContain("publickey");
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it("ignores an address that isn't https", () => {
    expect(sentryOrigin("http://key@o1.ingest.sentry.io/2")).toBeNull();
    expect(sentryOrigin("not a url")).toBeNull();
  });
});
