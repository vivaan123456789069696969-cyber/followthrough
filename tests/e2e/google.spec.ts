import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signInOwnUser } from "./session";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const FAKE = "http://127.0.0.1:54399";

/** Signs in and gives this browser its own Google account, with its own failure switches. */
async function start(context: BrowserContext, baseURL: string | undefined) {
  await signInOwnUser(context, baseURL);
  const account = randomUUID();
  await context.addCookies([{ name: "gacct", value: account, url: FAKE }]);
  return account;
}

async function control(account: string, settings: Record<string, unknown>) {
  await fetch(`${FAKE}/test/google`, { method: "POST", body: JSON.stringify({ account, ...settings }) });
}

async function googleAccount(context: BrowserContext) {
  const cookie = (await context.cookies(FAKE)).find((item) => item.name === "gacct");
  const response = await fetch(`${FAKE}/test/google-account?id=${cookie?.value}`);
  return (await response.json()) as {
    scopes: string[];
    revoked: boolean;
    calendars: { id: string; summary: string; events: { summary: string; start: { date: string }; end: { date: string } }[] }[];
    lists: { id: string; title: string; tasks: { title: string; status: string; due: string | null; notes: string }[] }[];
  };
}

async function turnOn(page: Page, name: string) {
  await page.goto("/settings");
  await page.getByRole("link", { name: `Turn on ${name}` }).click();
  await expect(page).toHaveURL(/\/settings\?google=connected-/);
}

/** A confirmed task, made the way the app makes manual ones. */
async function addTask(page: Page, title: string, due: string) {
  await page.goto("/tasks/new?return_to=%2Fmy-tasks");
  await page.getByLabel("Task", { exact: true }).fill(title);
  await page.getByLabel("Due date").fill(due);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page).toHaveURL(/\/my-tasks/);
}

test("Settings explains each permission before anything connects", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await page.goto("/settings");
  const google = page.getByRole("region", { name: "Google" });
  await expect(google.getByText("see events on calendars you own. It can't change them.")).toBeVisible();
  await expect(google.getByText("Your other calendars aren't touched.")).toBeVisible();
  await expect(google.getByRole("link", { name: "Turn on Calendar events" })).toHaveAttribute("href", "/api/google/connect?feature=calendar");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations).toEqual([]);
});

test("calendar events become meetings, once each", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await turnOn(page, "Calendar events");
  await expect(page.getByRole("status").filter({ hasText: "Calendar events are on." })).toBeVisible();
  // Only the permission asked for was granted.
  expect((await googleAccount(context)).scopes).toEqual(["https://www.googleapis.com/auth/calendar.events.owned.readonly"]);

  await page.goto("/meetings");
  const calendar = page.getByRole("region", { name: "From your calendar" });
  await expect(calendar.getByText("Launch planning", { exact: true })).toBeVisible();
  await expect(calendar.getByText("Cancelled sync")).toHaveCount(0);

  await calendar.getByRole("button", { name: "Create meeting from Launch planning" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Launch planning" })).toBeVisible();
  // Display names only: email addresses and meeting rooms aren't kept.
  await expect(page.getByText("Sam Lee")).toBeVisible();
  await expect(page.getByText(/priya/i)).toHaveCount(0);

  await page.goto("/meetings");
  await expect(page.getByRole("region", { name: "From your calendar" }).getByRole("link", { name: "Open meeting Launch planning" })).toBeVisible();
});

test("due dates go on a separate calendar and come off when done", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await turnOn(page, "Due dates in Calendar");

  await addTask(page, "Send the launch brief", "2030-03-31");
  await expect
    .poll(async () => (await googleAccount(context)).calendars[0]?.events ?? [])
    .toEqual([expect.objectContaining({ summary: "Due: Send the launch brief", start: { date: "2030-03-31" }, end: { date: "2030-04-01" } })]);
  expect((await googleAccount(context)).calendars[0]!.summary).toBe("FollowThrough");

  await page.getByRole("link", { name: /Send the launch brief/ }).click();
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expect(drawer.getByText("Synced", { exact: true })).toBeVisible({ timeout: 15_000 });
  await drawer.getByRole("button", { name: "Mark done" }).click();

  await expect.poll(async () => (await googleAccount(context)).calendars[0]!.events).toEqual([]);
});

test("confirmed tasks go to the chosen Google Tasks list, and are completed there", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await turnOn(page, "Google Tasks");

  const google = page.getByRole("region", { name: "Google" });
  await google.getByLabel("Google Tasks list").selectOption({ label: "Make a new list called FollowThrough" });
  await google.getByRole("button", { name: "Save list" }).click();
  await expect(google.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  const destination = page.getByRole("region", { name: "Task destination" });
  await destination.getByLabel("Google Tasks").check();
  await destination.getByRole("button", { name: "Save" }).click();
  await expect(destination.getByRole("status")).toHaveText("Saved.");

  await addTask(page, "Book the venue", "2030-05-02");
  await expect
    .poll(async () => (await googleAccount(context)).lists.find((list) => list.title === "FollowThrough")?.tasks ?? [])
    .toEqual([expect.objectContaining({ title: "Book the venue", status: "needsAction", due: "2030-05-02T00:00:00.000Z" })]);
  const pushed = (await googleAccount(context)).lists.find((list) => list.title === "FollowThrough")!.tasks[0]!;
  expect(pushed.notes).toContain("Open in FollowThrough: http://localhost:3100/my-day?task=");

  await page.getByRole("link", { name: /Book the venue/ }).click();
  await page.getByRole("dialog", { name: "Task details" }).getByRole("button", { name: "Mark done" }).click();
  await expect
    .poll(async () => (await googleAccount(context)).lists.find((list) => list.title === "FollowThrough")!.tasks[0]!.status)
    .toBe("completed");
});

test("a failed sync shows on the task and Retry fixes it", async ({ page, context, baseURL }) => {
  const account = await start(context, baseURL);
  await turnOn(page, "Due dates in Calendar");

  // Every attempt, including retries, fails.
  await control(account, { failWrites: 3 });
  await addTask(page, "Draft the agenda", "2030-06-10");
  await page.getByRole("link", { name: /Draft the agenda/ }).click();
  // The sync runs after the page responds, so reload until its result shows.
  await expect(page).toHaveURL(/task=/);
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expect(async () => {
    await page.reload();
    await expect(drawer.getByText("Not synced")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(drawer.getByText("Google is busy. This will be tried again.")).toBeVisible();

  await control(account, { failWrites: 0 });
  await drawer.getByRole("button", { name: "Retry" }).click();
  await expect(drawer.getByText("Synced", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(drawer.getByText("Not synced")).toHaveCount(0);
  expect((await googleAccount(context)).calendars[0]!.events).toHaveLength(1);
});

test("the scheduled job retries failed syncs, and only with its secret", async ({ page, context, baseURL }) => {
  const account = await start(context, baseURL);
  await turnOn(page, "Due dates in Calendar");
  await control(account, { failWrites: 3 });
  await addTask(page, "Order badges", "2030-07-01");
  await expect.poll(async () => (await googleAccount(context)).calendars[0]!.events.length).toBe(0);
  await control(account, { failWrites: 0 });

  const refused = await fetch(`${baseURL}/api/cron/google-sync`, { headers: { authorization: "Bearer wrong" } });
  expect(refused.status).toBe(401);

  // The failure waits a minute before its next try; the job picks it up once it's due.
  await expect
    .poll(
      async () => {
        await fetch(`${baseURL}/api/cron/google-sync`, { headers: { authorization: "Bearer e2e-cron-secret-at-least-32-characters-long" } });
        return (await googleAccount(context)).calendars[0]!.events.length;
      },
      { timeout: 90_000, intervals: [5000] },
    )
    .toBe(1);
});

test("a removed connection asks to reconnect instead of failing quietly", async ({ page, context, baseURL }) => {
  const account = await start(context, baseURL);
  await turnOn(page, "Due dates in Calendar");
  // Google forgets the app, as when access is removed in the Google account.
  await control(account, { revokeAll: true });

  await addTask(page, "Print handouts", "2030-08-01");
  await expect(async () => {
    await page.goto("/settings");
    await expect(page.getByRole("alert").filter({ hasText: "Google needs you to connect again." })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.getByRole("link", { name: "Reconnect Due dates in Calendar" })).toBeVisible();
});

test("tasks made before connecting are sent once due dates are turned on", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await addTask(page, "Renew the domain", "2030-09-15");
  await turnOn(page, "Due dates in Calendar");

  await expect
    .poll(async () => (await googleAccount(context)).calendars[0]?.events ?? [])
    .toEqual([expect.objectContaining({ summary: "Due: Renew the domain", start: { date: "2030-09-15" } })]);
});

test("after disconnecting, a task says why it isn't being sent instead of waiting forever", async ({ page, context, baseURL }) => {
  const account = await start(context, baseURL);
  await turnOn(page, "Due dates in Calendar");
  // Left failing: after disconnecting, nothing more is sent to Google anyway.
  await control(account, { failWrites: 3 });
  await addTask(page, "Send invoices", "2030-10-01");

  page.once("dialog", (dialog) => dialog.accept());
  await page.goto("/settings");
  await page.getByRole("button", { name: "Disconnect Google" }).click();
  await expect(page.getByRole("link", { name: "Turn on Due dates in Calendar" })).toBeVisible();

  await page.goto("/my-tasks");
  await page.getByRole("link", { name: /Send invoices/ }).click();
  await expect(page).toHaveURL(/task=/);
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expect(async () => {
    await page.reload();
    await expect(drawer.getByText("Not synced")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await drawer.getByRole("button", { name: "Retry" }).click();
  await expect(drawer.getByText("Google isn't connected, so this isn't being sent.")).toBeVisible({ timeout: 15_000 });
});

test("all-day events show as a date, with no made-up time", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await turnOn(page, "Calendar events");
  await page.goto("/meetings");
  const calendar = page.getByRole("region", { name: "From your calendar" });
  await expect(calendar.getByText("Sunday, November 10, all day")).toBeVisible();
});

test("cancelling or unticking on Google's page changes nothing", async ({ page, context, baseURL }) => {
  const account = await start(context, baseURL);
  await control(account, { deny: true });
  await page.goto("/settings");
  await page.getByRole("link", { name: "Turn on Calendar events" }).click();
  await expect(page.getByRole("status").filter({ hasText: "You cancelled on Google's page." })).toBeVisible();

  await control(account, { deny: false, untick: true });
  await page.getByRole("link", { name: "Turn on Calendar events" }).click();
  await expect(page.getByRole("status").filter({ hasText: "That permission wasn't given" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Turn on Calendar events" })).toBeVisible();
});

test("a reply that doesn't match this browser's request is refused", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await page.goto("/api/google/callback?code=stolen&state=forged");
  await expect(page).toHaveURL(/google=expired/);
  await expect(page.getByRole("link", { name: "Turn on Calendar events" })).toBeVisible();
});

test("disconnecting removes access at Google and turns everything off", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await turnOn(page, "Calendar events");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Disconnect Google" }).click();

  await expect(page.getByRole("link", { name: "Turn on Calendar events" })).toBeVisible();
  expect((await googleAccount(context)).revoked).toBe(true);
});

test("deleting the account removes Google's access first", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await turnOn(page, "Calendar events");
  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await dialog.getByLabel("Type delete to confirm").fill("delete");
  await dialog.getByRole("button", { name: "Delete my account" }).click();

  await expect(page).toHaveURL(/account=deleted/);
  expect((await googleAccount(context)).revoked).toBe(true);
});

test("deleting a task removes its copies in Google", async ({ page, context, baseURL }) => {
  await start(context, baseURL);
  await turnOn(page, "Due dates in Calendar");
  await addTask(page, "Cancel the booth", "2030-07-01");
  await expect.poll(async () => (await googleAccount(context)).calendars[0]?.events ?? []).toHaveLength(1);

  await page.getByRole("link", { name: /Cancel the booth/ }).click();
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expect(drawer.getByText("Synced", { exact: true })).toBeVisible({ timeout: 15_000 });
  await drawer.getByText("Delete task", { exact: true }).click();
  await drawer.getByRole("button", { name: "Delete this task" }).click();

  await expect(page.getByRole("link", { name: /Cancel the booth/ })).toHaveCount(0);
  expect((await googleAccount(context)).calendars[0]!.events).toEqual([]);
});

test("if Google can't be reached, the task stays and says why", async ({ page, context, baseURL }) => {
  const account = await start(context, baseURL);
  await turnOn(page, "Due dates in Calendar");
  await addTask(page, "Keep until Google answers", "2030-07-02");
  await expect.poll(async () => (await googleAccount(context)).calendars[0]?.events ?? []).toHaveLength(1);

  await page.getByRole("link", { name: /Keep until Google answers/ }).click();
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expect(drawer.getByText("Synced", { exact: true })).toBeVisible({ timeout: 15_000 });
  await control(account, { failWrites: 10 });
  await drawer.getByText("Delete task", { exact: true }).click();
  await drawer.getByRole("button", { name: "Delete this task" }).click();
  await expect(drawer.getByRole("alert")).toHaveText("We couldn't remove this from Google. Try again in a moment.");
  expect((await googleAccount(context)).calendars[0]!.events).toHaveLength(1);

  // Google answers again: now it goes.
  await control(account, { failWrites: 0 });
  await drawer.getByRole("button", { name: "Delete this task" }).click();
  await expect(page.getByRole("link", { name: /Keep until Google answers/ })).toHaveCount(0);
  expect((await googleAccount(context)).calendars[0]!.events).toEqual([]);
});