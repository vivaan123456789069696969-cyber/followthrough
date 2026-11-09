import { expect, test } from "@playwright/test";

// What every page tells the browser, on a public page and a private one.
for (const path of ["/", "/sign-in", "/unsubscribe", "/my-day"]) {
  test(`${path} sends the security headers`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    const header = (name: string) => response.headers()[name];

    expect(header("x-frame-options")).toBe("DENY");
    expect(header("x-content-type-options")).toBe("nosniff");
    expect(header("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(header("strict-transport-security")).toContain("max-age=");
    expect(header("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(header("cross-origin-opener-policy")).toBe("same-origin");
    expect(header("x-powered-by")).toBeUndefined();

    const policy = header("content-security-policy") ?? "";
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
    // Only this app's own address, plus (when on) the error-reporting address.
    expect(policy).toMatch(/connect-src 'self'( |;|$)/);
  });
}
