import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { dayFromToday, seed, signInOwnUser } from "./session";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

// The app saves the browser's timezone at sign-in; these tests reason in UTC.
test.use({ timezoneId: "UTC" });
const FAKE = "http://127.0.0.1:54399";
const CRON = { authorization: "Bearer e2e-cron-secret-at-least-32-characters-long" };

type Email = { subject: string; html: string; text: string; to: string[]; headers: Record<string, string>; idempotencyKey: string };

/** Emails sent for this person, found by their id in the unsubscribe link. */
async function emailsFor(userId: string): Promise<Email[]> {
  const all = (await (await fetch(`${FAKE}/test/emails`)).json()) as Email[];
  return all.filter((email) => email.text.includes(`u=${userId}`));
}

async function runAt(baseURL: string | undefined, isoTime: string) {
  const response = await fetch(`${baseURL}/api/cron/reminders?now=${encodeURIComponent(isoTime)}`, { headers: CRON });
  expect(response.status).toBe(200);
  return response.json();
}

async function turnOnReminders(page: Page, options: { quiet?: [string, string]; at?: string } = {}) {
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Reminders" });
  await section.getByLabel("Email me reminders").check();
  await section.getByLabel("Email at").fill(options.at ?? "08:00");
  await section.getByLabel("From").fill(options.quiet?.[0] ?? "");
  await section.getByLabel("Until").fill(options.quiet?.[1] ?? "");
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("status")).toHaveText("Saved.");
}

const today = () => dayFromToday(0);

test("reminder settings save, and say they're off until turned on", async ({ page, context, baseURL }) => {
  await signInOwnUser(context, baseURL);
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Reminders" });
  await expect(section.getByLabel("Email me reminders")).not.toBeChecked();
  await expect(section.getByLabel("Email at")).toHaveValue("08:00");
  await expect(section.getByLabel("From")).toHaveValue("21:00");
  await expect(section.getByLabel("Until")).toHaveValue("07:00");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations).toEqual([]);

  await section.getByLabel("Email me reminders").check();
  await section.getByLabel("Due tomorrow").check();
  await section.getByLabel("Email at").fill("07:30");
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("status")).toHaveText("Saved.");

  await page.reload();
  await expect(section.getByLabel("Email me reminders")).toBeChecked();
  await expect(section.getByLabel("Due tomorrow")).toBeChecked();
  await expect(section.getByLabel("Email at")).toHaveValue("07:30");
});

test("quiet hours need both ends", async ({ page, context, baseURL }) => {
  await signInOwnUser(context, baseURL);
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Reminders" });
  await section.getByLabel("Until").fill("");
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("alert")).toHaveText("Set both ends of quiet hours, or neither.");
});

test("one morning email with what's due and overdue, sent once however often the job runs", async ({ page, context, baseURL }) => {
  const { token, userId } = await signInOwnUser(context, baseURL);
  // A time no other test runs the job at, since every run sends whatever is due for anyone.
  await turnOnReminders(page, { at: "20:00" });
  await seed(token, "tasks", [
    { title: "Send the launch brief", due_date: today(), owner_user_id: userId, created_by: userId },
    { title: "Book the venue", due_date: dayFromToday(-3), owner_user_id: userId, created_by: userId },
    { title: "Already done", due_date: today(), status: "done", owner_user_id: userId, created_by: userId },
    { title: "Long overdue", due_date: dayFromToday(-10), owner_user_id: userId, created_by: userId },
    { title: "Snoozed", due_date: today(), snoozed_until: dayFromToday(2), owner_user_id: userId, created_by: userId },
  ]);

  // Too early: nothing yet.
  await runAt(baseURL, `${today()}T19:50:00Z`);
  expect(await emailsFor(userId)).toHaveLength(0);

  // Two runs at the same moment, then another later: still one email.
  await Promise.all([runAt(baseURL, `${today()}T20:05:00Z`), runAt(baseURL, `${today()}T20:05:00Z`)]);
  await runAt(baseURL, `${today()}T20:20:00Z`);

  const emails = await emailsFor(userId);
  expect(emails).toHaveLength(1);
  const [email] = emails as [Email];
  expect(email.subject).toBe("2 things need you today");
  expect(email.text).toContain("Send the launch brief");
  expect(email.text).toContain("Book the venue");
  for (const left of ["Already done", "Long overdue", "Snoozed"]) expect(email.text).not.toContain(left);
  expect(email.text).toContain("Open task: http://localhost:3100/my-day?task=");
  expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  expect(email.headers["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:3100\/api\/unsubscribe\?u=/);
});

test("only the person's own tasks are in their email, not ones others made", async ({ page, context, baseURL }) => {
  const { token, userId } = await signInOwnUser(context, baseURL);
  await turnOnReminders(page, { at: "03:00" });
  await seed(token, "tasks", [
    { title: "My own task", due_date: today(), owner_user_id: userId, created_by: userId },
    // In the same workspace, made and owned by someone else.
    { title: "A colleague's task", due_date: today(), owner_user_id: "99999999-9999-4999-8999-999999999999", created_by: "99999999-9999-4999-8999-999999999999" },
  ]);
  await runAt(baseURL, `${today()}T03:05:00Z`);
  const [email] = (await emailsFor(userId)) as [Email];
  expect(email.text).toContain("My own task");
  expect(email.text).not.toContain("A colleague's task");
});

test("an email due in quiet hours waits until they end", async ({ page, context, baseURL }) => {
  const { token, userId } = await signInOwnUser(context, baseURL);
  await turnOnReminders(page, { quiet: ["07:00", "09:00"] });
  await seed(token, "tasks", [{ title: "Call the printer", due_date: today(), owner_user_id: userId, created_by: userId }]);

  await runAt(baseURL, `${today()}T08:05:00Z`);
  expect(await emailsFor(userId)).toHaveLength(0);

  await runAt(baseURL, `${today()}T09:05:00Z`);
  const emails = await emailsFor(userId);
  expect(emails.map((email) => email.subject)).toEqual(["Due today: Call the printer"]);
});

test("changing the time after today's email doesn't bring a second one", async ({ page, context, baseURL }) => {
  const { token, userId } = await signInOwnUser(context, baseURL);
  await turnOnReminders(page, { at: "04:00" });
  await seed(token, "tasks", [{ title: "Check the contract", due_date: today(), owner_user_id: userId, created_by: userId }]);
  await runAt(baseURL, `${today()}T04:05:00Z`);
  expect(await emailsFor(userId)).toHaveLength(1);

  await turnOnReminders(page, { at: "05:00" });
  await runAt(baseURL, `${today()}T05:05:00Z`);
  expect(await emailsFor(userId)).toHaveLength(1);
});

test("the link in the email turns reminders off without signing in", async ({ page, context, browser, baseURL }) => {
  const { token, userId } = await signInOwnUser(context, baseURL);
  await turnOnReminders(page);
  await seed(token, "tasks", [{ title: "Order badges", due_date: today(), owner_user_id: userId, created_by: userId }]);
  await runAt(baseURL, `${today()}T08:05:00Z`);
  const [email] = (await emailsFor(userId)) as [Email];
  const link = /Turn off reminders: (\S+)/.exec(email.text)![1]!;

  // A different browser with no session, as from a phone's mail app.
  const stranger = await browser.newContext();
  const outside = await stranger.newPage();
  await outside.goto(link);
  await expect(outside.getByRole("heading", { name: "Turn off reminder emails?" })).toBeVisible();
  await outside.getByRole("button", { name: "Turn off reminders" }).click();
  await expect(outside.getByRole("heading", { name: "Reminders are off" })).toBeVisible();
  await stranger.close();

  await page.goto("/settings");
  await expect(page.getByRole("region", { name: "Reminders" }).getByLabel("Email me reminders")).not.toBeChecked();
});

test("mail apps' one-click unsubscribe works, and forged links don't", async ({ page, context, baseURL }) => {
  const { token, userId } = await signInOwnUser(context, baseURL);
  await turnOnReminders(page);
  await seed(token, "tasks", [{ title: "Pay the venue", due_date: today(), owner_user_id: userId, created_by: userId }]);
  await runAt(baseURL, `${today()}T08:05:00Z`);
  const [email] = (await emailsFor(userId)) as [Email];
  const oneClick = /^<(.+)>$/.exec(email.headers["List-Unsubscribe"]!)![1]!;

  const forged = await fetch(oneClick.replace(/s=[^&]+/, "s=forged"), { method: "POST", body: "List-Unsubscribe=One-Click" });
  expect(forged.status).toBe(400);
  // Opening the link (a GET, as scanners do) changes nothing.
  expect((await fetch(oneClick)).status).toBe(405);

  const real = await fetch(oneClick, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  expect(real.status).toBe(200);
  await page.goto("/settings");
  await expect(page.getByRole("region", { name: "Reminders" }).getByLabel("Email me reminders")).not.toBeChecked();
});

test("a broken unsubscribe link says so", async ({ page }) => {
  await page.goto("/unsubscribe?u=00000000-0000-4000-8000-000000000009&s=nope");
  await page.getByRole("button", { name: "Turn off reminders" }).click();
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
});

test("the reminder job turns away a wrong secret", async ({ baseURL }) => {
  const response = await fetch(`${baseURL}/api/cron/reminders`, { headers: { authorization: "Bearer wrong" } });
  expect(response.status).toBe(401);
});

test("the preview shows today's email without sending it", async ({ page, context, baseURL }) => {
  const { token, userId } = await signInOwnUser(context, baseURL);
  await seed(token, "tasks", [{ title: "Draft the agenda", due_date: today(), owner_user_id: userId, created_by: userId }]);
  await page.goto("/settings/reminders/preview");
  await expect(page.getByText("Draft the agenda")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open task" })).toBeVisible();
  expect(await emailsFor(userId)).toHaveLength(0);
});
