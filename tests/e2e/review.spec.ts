import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInFresh } from "./session";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function meetingWithNotes(page: Page, notes: string) {
  await page.goto("/meetings/new");
  await page.getByLabel("Meeting title").fill("Product sync");
  await page.getByRole("button", { name: "Add meeting" }).click();
  await page.getByLabel("Paste notes").fill(notes);
  await page.getByRole("button", { name: "Add notes" }).click();
  await expect(page.getByRole("region", { name: "Meeting notes" })).toBeVisible();
}

async function suggest(page: Page) {
  await expect(page.getByText("This sends these notes to Anthropic's Claude")).toBeVisible();
  await page.getByRole("button", { name: "Suggest actions" }).click();
  await expect(page).toHaveURL(/\/review\?note=/, { timeout: 30_000 });
}

test("suggest, review against the notes, confirm, and see it on My day", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await meetingWithNotes(page, "Product sync\n14:32 Sam: Maya, can you send the revised launch brief by Thursday?\nWe should revisit onboarding.");

  await suggest(page);

  const card = page.locator("[data-suggestion]").first();
  await expect(card).toContainText("“Maya, can you send the revised launch brief by Thursday?”");
  await expect(card).toContainText("Pasted notes · 14:32");
  await expect(card).toContainText("Maya");
  await expect(page.getByRole("region", { name: "Meeting notes" }).locator("mark[id^=quote-]")).toHaveText(
    "Suggested: Maya, can you send the revised launch brief by Thursday?",
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations).toEqual([]);

  await card.getByRole("button", { name: "Confirm task" }).click();
  await expect(page.getByRole("heading", { name: "All reviewed" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Task confirmed. All reviewed." })).toBeAttached();

  await page.goto("/my-day");
  const row = page.getByRole("link", { name: /send the revised launch brief/i });
  await expect(row).toContainText("Product sync");
  await row.click();
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expect(drawer).toContainText("“Maya, can you send the revised launch brief by Thursday?”");
  await drawer.getByRole("link", { name: "Open in notes" }).click();
  await expect(page).toHaveURL(/\/review\?note=.*#quote-/);
});

test("a suggestion whose words aren't in the notes is removed and counted", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await meetingWithNotes(page, "Sam: Priya will update the pricing page.\nFABRICATE");

  await suggest(page);

  await expect(page.getByRole("status").filter({ hasText: "removed" })).toHaveText("1 suggestion was removed because its words couldn't be found in the notes.");
  await expect(page.locator("[data-suggestion]")).toHaveCount(1);
  await expect(page.getByText("Wire money")).toHaveCount(0);
});

test("missing owner and date are flagged and can be filled in before confirming", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await meetingWithNotes(page, "Retro\nSam: I'll fix the flaky tests.");

  await suggest(page);

  const card = page.locator("[data-suggestion]").first();
  await expect(card.getByText("Needs date")).toBeVisible();
  await card.getByRole("button", { name: "Edit details" }).click();
  await card.getByLabel("Owner").selectOption("other");
  await card.getByLabel("Their name").fill("Sam");
  await card.getByLabel("Due date").fill("2030-01-15");
  await card.getByRole("button", { name: "Confirm task" }).click();

  await page.goto("/my-tasks?view=waiting");
  await expect(page.getByRole("link", { name: /fix the flaky tests/i })).toContainText("Owner: Sam");
});

test("dismiss and restore a suggestion", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await meetingWithNotes(page, "Sam: Priya will update the pricing page.");
  await suggest(page);

  await page.locator("[data-suggestion]").first().getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator("[data-suggestion]")).toHaveCount(0);

  await page.getByText("Dismissed (1)").click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator("[data-suggestion]")).toHaveCount(1);
});

test("confirm all complete shows a summary first and confirms only complete ones", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await meetingWithNotes(page, "Sam: Maya, can you send the brief by Friday?\nSam: Priya will update the pricing page.");
  await suggest(page);

  await page.getByRole("button", { name: "Confirm all complete (1)" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm 1 task?" });
  await expect(dialog).toContainText(/send the brief/i);
  await dialog.getByRole("button", { name: "Confirm 1" }).click();

  await expect(page.locator("[data-suggestion]")).toHaveCount(1);
  await expect(page.locator("[data-suggestion]").first()).toContainText("Priya will update the pricing page.");
});

test("keyboard: inside the list, J moves and C confirms, then focus moves on", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await meetingWithNotes(page, "Sam: Priya will update the pricing page.\nSam: Leo will book the venue.");
  await suggest(page);
  const cards = page.locator("[data-suggestion]");

  // Outside the list, letters do nothing.
  await page.locator("body").press("j");
  await expect(cards.first()).not.toBeFocused();

  await cards.first().focus();
  await page.keyboard.press("j");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press("c");

  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Task confirmed. 1 to review." })).toBeAttached();

  await page.keyboard.press("x");
  await expect(page.getByRole("heading", { name: "All reviewed" })).toBeFocused();
});

test("notes with emoji keep their suggestions and highlights", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await meetingWithNotes(page, "ðŸš€ Launch sync ðŸŽ‰\nSam: Priya will update the pricing page.");
  await suggest(page);

  await expect(page.locator("[data-suggestion]")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Meeting notes" }).locator("mark[id^=quote-]")).toHaveText("Suggested: Priya will update the pricing page.");
});

test("asking again doesn't bring back what was already confirmed", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await meetingWithNotes(page, "Sam: Priya will update the pricing page.");
  await suggest(page);
  await page.locator("[data-suggestion]").first().getByRole("button", { name: "Confirm task" }).click();
  await expect(page.getByRole("heading", { name: "All reviewed" })).toBeVisible();

  await page.getByRole("link", { name: "Product sync" }).click();
  await suggest(page);

  await expect(page.locator("[data-suggestion]")).toHaveCount(0);
  await expect(page.getByText("1 confirmed. Your tasks are on My day.")).toBeVisible();
});

test("notes with no commitments say so and offer to add one", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await meetingWithNotes(page, "Thanks everyone. Good meeting.");
  await suggest(page);

  await expect(page.getByText("No actions found. Add one yourself.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add action" })).toBeVisible();
});

test("pages carry a nonce-based content security policy and still work", async ({ page }) => {
  const response = await page.goto("/sign-in");
  const policy = response!.headers()["content-security-policy"] ?? "";

  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain("unsafe-eval");

  // React has to run under the policy for the form to work.
  await page.getByLabel("Email").fill("fail@example.com");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("We couldn't send the link. Try again.");
});

test("injected markup can't run script", async ({ page }) => {
  await page.goto("/sign-in");

  // The usual shape of an injection: HTML with an inline event handler.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", `<img src="data:," alt="" onload="window.__injected = true" onerror="window.__injected = true">`);
  });
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => "__injected" in window)).toBe(false);
});
