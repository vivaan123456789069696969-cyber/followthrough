import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("protected pages send signed-out visitors to sign-in", async ({ page }) => {
  await page.goto("/my-day?from=test");

  await expect(page).toHaveURL(/\/sign-in\?next=%2Fmy-day%3Ffrom%3Dtest$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("a page nobody has built yet is still private", async ({ page }) => {
  await page.goto("/settings");

  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings$/);
});

test("forged session cookies don't open protected pages", async ({ page, context, baseURL }) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const farFuture = Math.floor(Date.now() / 1000) + 3600;
  const forgedToken = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: "00000000-0000-4000-8000-000000000001", role: "authenticated", exp: farFuture }),
    "forged-signature",
  ].join(".");
  const session = {
    access_token: forgedToken,
    refresh_token: "forged",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: farFuture,
    user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated" },
  };
  // Named as Supabase names it for this project URL, so the auth code really reads it.
  await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${encode(session)}`, url: baseURL! }]);

  await page.goto("/my-day");

  await expect(page).toHaveURL(/\/sign-in/);
});

test("the sign-in form explains when a link can't be sent", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByLabel("Email").fill("maya@example.com");
  await page.getByRole("button", { name: "Send sign-in link" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText("We couldn't send the link. Try again.", {
    timeout: 30_000,
  });
});

test("sign-in offers Google and email", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("the callback rejects a missing code", async ({ page }) => {
  await page.goto("/auth/callback?next=https://evil.com");

  await expect(page).toHaveURL(/localhost.*\/sign-in\?error=link$/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("That link didn't work or has expired. Send a new one.");
});

test("the sign-in page has no accessibility violations", async ({ page }) => {
  await page.goto("/sign-in?error=link");

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("the home page leads to sign-in", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
});
