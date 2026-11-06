import { describe, expect, it } from "vitest";
import { HOME_AFTER_SIGN_IN, routeDecision, safeNextPath } from "@/lib/auth/routes";
import { isValidTimezone } from "@/lib/auth/timezone";

describe("safeNextPath", () => {
  it.each(["/my-day", "/meetings/123?tab=notes", "/tasks#open"])("keeps the same-site path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ["nothing", null],
    ["empty", ""],
    ["a full URL", "https://evil.com"],
    ["a protocol-relative URL", "//evil.com"],
    ["a backslash URL", "/\\evil.com"],
    ["a backslash later on", "/foo\\..\\..\\evil.com"],
    ["a script URL", "javascript:alert(1)"],
    ["a relative path", "my-day"],
    ["a tab inside the slashes", "/\t/evil.com"],
    ["a newline", "/foo\nbar"],
    ["a dot segment hiding a host", "/.//evil.com"],
    ["an encoded dot segment", "/%2e//evil.com"],
    ["a parent segment", "/foo/..//evil.com"],
    ["a parent segment at the root", "/..//evil.com"],
  ])("falls back to the home page for %s", (_name, value) => {
    expect(safeNextPath(value)).toBe(HOME_AFTER_SIGN_IN);
  });
});

describe("routeDecision", () => {
  it.each(["/", "/sign-in", "/auth/callback", "/auth/confirm"])("lets signed-out visitors reach %s", (pathname) => {
    expect(routeDecision({ pathname, search: "", isSignedIn: false })).toBeNull();
  });

  it("sends signed-out visitors to sign-in and remembers where they were going", () => {
    expect(routeDecision({ pathname: "/my-day", search: "?a=1", isSignedIn: false })).toBe("/sign-in?next=%2Fmy-day%3Fa%3D1");
  });

  it("protects a page nobody has listed, so new pages are private by default", () => {
    expect(routeDecision({ pathname: "/some-new-page", search: "", isSignedIn: false })).toContain("/sign-in");
  });

  it("does not treat lookalike paths as public", () => {
    expect(routeDecision({ pathname: "/sign-in-admin", search: "", isSignedIn: false })).toContain("/sign-in?next=");
    expect(routeDecision({ pathname: "/auth/callback/extra", search: "", isSignedIn: false })).toContain("/sign-in?next=");
  });

  it("sends signed-in users past the sign-in page", () => {
    expect(routeDecision({ pathname: "/sign-in", search: "", isSignedIn: true })).toBe(HOME_AFTER_SIGN_IN);
  });

  it("lets signed-in users through everywhere else", () => {
    expect(routeDecision({ pathname: "/my-day", search: "", isSignedIn: true })).toBeNull();
    expect(routeDecision({ pathname: "/", search: "", isSignedIn: true })).toBeNull();
  });
});

describe("isValidTimezone", () => {
  it.each(["Asia/Kolkata", "America/Los_Angeles", "UTC"])("accepts %s", (timezone) => {
    expect(isValidTimezone(timezone)).toBe(true);
  });

  it.each([["made up", "Mars/Olympus"], ["empty", ""], ["not text", 42], ["missing", null], ["too long", "x".repeat(101)]])(
    "rejects %s",
    (_name, value) => {
      expect(isValidTimezone(value)).toBe(false);
    },
  );
});
