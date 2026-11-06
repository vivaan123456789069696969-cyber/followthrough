import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { setSession, signInFresh } from "./session";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

test.describe("signed out", () => {
  test("protected pages send visitors to sign-in", async ({ page }) => {
    await page.goto("/my-day?from=test");

    await expect(page).toHaveURL(/\/sign-in\?next=%2Fmy-day%3Ffrom%3Dtest$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("a page nobody has built yet is still private", async ({ page }) => {
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings$/);
  });

  test("a path that looks like an image is still private", async ({ page }) => {
    await page.goto("/api/meetings/x.png");

    await expect(page).toHaveURL(/\/sign-in\?next=/);
  });

  test("a session with a bad signature is rejected", async ({ page, context, baseURL }) => {
    await setSession(context, baseURL, "forged-signature");

    await page.goto("/my-day");

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("a garbled session cookie is treated as signed out", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "sb-127-auth-token", value: "base64-bm90LWpzb24", url: baseURL! }]);

    await page.goto("/my-day");

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("the home page leads to sign-in", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
  });
});

test.describe("sign-in page", () => {
  test("offers Google and email", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("confirms when the link is sent", async ({ page }) => {
    await page.goto("/sign-in");

    await page.getByLabel("Email").fill("maya@example.com");
    await page.getByRole("button", { name: "Send sign-in link" }).click();

    await expect(page.getByRole("main").getByRole("status")).toContainText("We sent a sign-in link to maya@example.com");
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });

  test("explains when a link can't be sent and keeps the address", async ({ page }) => {
    await page.goto("/sign-in");

    await page.getByLabel("Email").fill("fail@example.com");
    await page.getByRole("button", { name: "Send sign-in link" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText("We couldn't send the link. Try again.", { timeout: 30_000 });
    await expect(page.getByLabel("Email")).toHaveValue("fail@example.com");
  });

  test("explains rate limits", async ({ page }) => {
    await page.goto("/sign-in");

    await page.getByLabel("Email").fill("busy@example.com");
    await page.getByRole("button", { name: "Send sign-in link" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Too many requests. Try again later.");
  });

  for (const [path, message] of [
    ["/sign-in?error=link", "That link didn't work or has expired. Send a new one."],
    ["/auth/callback", "That link didn't work or has expired. Send a new one."],
    ["/auth/callback?error=access_denied&error_code=cancelled", "We couldn't sign you in. Try again."],
  ] as const) {
    test(`shows the right message for ${path}`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL(/localhost.*\/sign-in\?error=\w+$/);
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(message);
    });
  }

  test("ignores unknown error codes, including ones that look like object properties", async ({ page }) => {
    const response = await page.goto("/sign-in?error=constructor");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/sign-in?error=link");

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });

  test("the callback response is never cached", async ({ request }) => {
    const response = await request.get("/auth/callback", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("signed in", () => {
  test("a valid session opens the private page", async ({ page, context, baseURL }) => {
    await signInFresh(context, baseURL);

    await page.goto("/my-day");

    await expect(page).toHaveURL(/\/my-day$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Maya$/);
  });

  test("the sign-in page sends signed-in users onward", async ({ page, context, baseURL }) => {
    await setSession(context, baseURL, "good-session");

    await page.goto("/sign-in");

    await expect(page).toHaveURL(/\/my-day$/);
  });

  test("signing out ends the session", async ({ page, context, baseURL }) => {
    await setSession(context, baseURL, "good-session");
    await page.goto("/settings");

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(new RegExp(`^${baseURL}/?$`));
    await page.goto("/my-day");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("signing out clears the cookie when set by the app", async ({ page, context, baseURL }) => {
    await setSession(context, baseURL, "good-session");
    await page.goto("/settings");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/?$`));

    const cookies = await context.cookies();
    expect(cookies.filter((cookie) => cookie.name.startsWith("sb-") && cookie.value)).toEqual([]);
  });

  test.describe("timezone", () => {
    test.use({ timezoneId: "America/New_York" });

    test("is saved from the browser at first sign-in", async ({ page, context, baseURL, request }) => {
      // A session of its own, so no other test has saved a timezone for it already.
      // "good-" plus 31 characters: 36 in all, a valid base64url length.
      await setSession(context, baseURL, `good-${randomUUID().replace(/-/g, "").slice(0, 31)}`);

      await page.goto("/my-day");

      await expect
        .poll(async () => (await request.get("http://127.0.0.1:54399/test/timezones")).json())
        .toContain("America/New_York");
    });
  });

  test("an account with no profile still loads and can sign out", async ({ page, context, baseURL }) => {
    await setSession(context, baseURL, "good-no-profile");

    await page.goto("/settings");

    await expect(page.getByText("Signed in as maya@example.com.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("a database outage shows a way out instead of a dead end", async ({ page, context, baseURL }) => {
    await setSession(context, baseURL, "good-db-down");

    await page.goto("/settings");

    await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/?$`));
    await page.goto("/my-day");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
