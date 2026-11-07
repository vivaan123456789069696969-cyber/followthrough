import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";
import { seed, setSession, signInFresh } from "./session";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** Someone who hasn't been through setup. "good-new" + 32 characters is a valid signature length. */
async function signInNew(context: BrowserContext, baseURL: string | undefined) {
  const token = `good-new${randomUUID().replace(/-/g, "")}`;
  await setSession(context, baseURL, token);
  return token;
}

async function stateOf(token: string) {
  const response = await fetch("http://127.0.0.1:54399/test/state", { method: "POST", body: JSON.stringify({ token }) });
  return (await response.json()) as {
    deleted: boolean;
    fullName: string;
    timezone: string | null;
    settings: { onboarding_done: boolean; note_retention_days: number | null; task_destination: string | null };
  };
}

test.describe("setup", () => {
  test("a new account sees setup first, and can skip everything", async ({ page, context, baseURL }) => {
    const token = await signInNew(context, baseURL);
    await page.goto("/my-day");

    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome, Maya" })).toBeVisible();
    await expect(page.getByText("Optional by default")).toBeVisible();
    // Honest states only: nothing claims to be connected.
    await expect(page.getByText(/connected/i)).toHaveCount(0);
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);

    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page).toHaveURL(/\/my-day$/);
    expect((await stateOf(token)).settings).toMatchObject({ onboarding_done: true, task_destination: null });

    // The app is fully usable with nothing set up.
    await page.goto("/meetings/new");
    await expect(page.getByLabel("Meeting title")).toBeVisible();
  });

  test("finishing setup saves where tasks go", async ({ page, context, baseURL }) => {
    const token = await signInNew(context, baseURL);
    await page.goto("/setup");

    await page.getByLabel("Google Tasks").check();
    await page.getByRole("button", { name: "Finish setup" }).click();

    await expect(page).toHaveURL(/\/my-day$/);
    expect((await stateOf(token)).settings).toMatchObject({ onboarding_done: true, task_destination: "google_tasks" });
  });

  test("someone who already finished setup goes straight to the app", async ({ page, context, baseURL }) => {
    await signInFresh(context, baseURL);
    await page.goto("/my-day");
    await expect(page).toHaveURL(/\/my-day$/);
  });
});

test.describe("settings", () => {
  test("each section saves on its own", async ({ page, context, baseURL }) => {
    const token = await signInFresh(context, baseURL);
    await page.goto("/settings");

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);

    const profile = page.getByRole("region", { name: "Profile" });
    await profile.getByLabel("Your name").fill("Vivaan");
    await profile.getByRole("button", { name: "Save" }).first().click();
    await expect(profile.getByRole("status").first()).toHaveText("Saved.");

    await profile.getByLabel("Timezone").selectOption("America/New_York");
    await profile.getByRole("button", { name: "Save" }).nth(1).click();
    await expect(profile.getByRole("status").nth(1)).toHaveText("Saved.");

    const notes = page.getByRole("region", { name: "Keeping notes" });
    await notes.getByLabel("Original notes").selectOption("90");
    await notes.getByRole("button", { name: "Save" }).click();
    await expect(notes.getByRole("status")).toHaveText("Saved.");

    const destination = page.getByRole("region", { name: "Task destination" });
    await destination.getByLabel("In this app").check();
    await destination.getByRole("button", { name: "Save" }).click();
    await expect(destination.getByRole("status")).toHaveText("Saved.");

    const state = await stateOf(token);
    expect(state.fullName).toBe("Vivaan");
    expect(state.timezone).toBe("America/New_York");
    expect(state.settings).toMatchObject({ note_retention_days: 90, task_destination: "app" });

    // Saved values come back after a reload.
    await page.reload();
    await expect(page.getByLabel("Your name")).toHaveValue("Vivaan");
    await expect(page.getByLabel("Original notes")).toHaveValue("90");
  });

  test("says what the AI receives and how much of the limit is used", async ({ page, context, baseURL }) => {
    await signInFresh(context, baseURL);
    await page.goto("/settings");
    const ai = page.getByRole("region", { name: "AI suggestions" });
    await expect(ai).toContainText("those notes are sent to Anthropic's Claude");
    await expect(ai).toContainText("This month: $0.00 of your $5.00 limit.");
  });

  test("export downloads everything as JSON", async ({ page, context, baseURL }) => {
    const token = await signInFresh(context, baseURL);
    await seed(token, "tasks", [{ title: "Send the brief" }]);
    await page.goto("/settings");

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export data" }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^followthrough-export-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = JSON.parse(await (await import("node:fs/promises")).readFile((await file.path())!, "utf8"));
    expect(exported.format).toBe("followthrough-export-1");
    expect(exported.data.tasks).toEqual([expect.objectContaining({ title: "Send the brief" })]);
  });

  test("delete account asks for the word, then deletes and signs out", async ({ page, context, baseURL }) => {
    const token = await signInFresh(context, baseURL);
    await page.goto("/settings");

    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your account?" });
    await dialog.getByLabel("Type delete to confirm").fill("yes");
    await dialog.getByRole("button", { name: "Delete my account" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Type delete to confirm.");
    expect((await stateOf(token)).deleted).toBe(false);

    await dialog.getByLabel("Type delete to confirm").fill("delete");
    await dialog.getByRole("button", { name: "Delete my account" }).click();

    await expect(page).toHaveURL(/\/\?account=deleted$/);
    await expect(page.getByRole("status")).toHaveText("Your account and everything in it were deleted.");
    expect((await stateOf(token)).deleted).toBe(true);

    await page.goto("/my-day");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("another device still signed in is signed out cleanly after deletion", async ({ page, browser, context, baseURL }) => {
    const token = await signInFresh(context, baseURL);
    const other = await browser.newContext();
    await setSession(other, baseURL, token);
    const otherPage = await other.newPage();
    await otherPage.goto("/my-day");
    await expect(otherPage.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your account?" });
    await dialog.getByLabel("Type delete to confirm").fill("delete");
    await dialog.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/account=deleted/);

    await otherPage.goto("/my-day");
    await expect(otherPage).toHaveURL(/\/\?account=ended$/);
    await expect(otherPage.getByRole("status")).toHaveText("You were signed out because this account no longer exists.");
    await other.close();
  });

  test("nothing in Settings claims a connection, and the delete dialog passes axe", async ({ page, context, baseURL }) => {
    await signInFresh(context, baseURL);
    await page.goto("/settings");
    await expect(page.getByText(/\bconnected\b/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Delete account" }).click();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });
});
