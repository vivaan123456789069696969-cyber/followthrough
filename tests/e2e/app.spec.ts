import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { dayFromToday, seed, signInFresh, USER_ID } from "./session";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const tile = (page: Page, label: string) => page.getByRole("region", { name: "Summary" }).getByRole("link", { name: new RegExp(label) });

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations).toEqual([]);
}

async function addMeeting(page: Page, title: string) {
  await page.goto("/meetings/new");
  await page.getByLabel("Meeting title").fill(title);
  await page.getByRole("button", { name: "Add meeting" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test("golden path: meeting, notes and a task show up on the dashboard", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);

  await addMeeting(page, "Product sync");

  await page.getByLabel("Paste notes").fill("14:32 Maya, can you send the revised launch brief by Thursday?");
  await page.getByRole("button", { name: "Add notes" }).click();
  await expect(page.getByRole("region", { name: "Meeting notes" })).toContainText("revised launch brief");
  await expect(page.getByText("Has timestamps")).toBeVisible();

  await page.getByRole("link", { name: "Add action" }).click();
  await page.getByLabel("Task", { exact: true }).fill("Send revised launch brief");
  await page.getByLabel("Due date").fill(dayFromToday(0));
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page).toHaveURL(/\/meetings\//);
  await expect(page.getByRole("link", { name: /Send revised launch brief/ })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My day" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Maya$/);
  await expect(tile(page, "Due soon")).toContainText("1");
  const row = page.getByRole("link", { name: /Send revised launch brief/ });
  await expect(row).toContainText("Product sync");
  await expect(row).toContainText("Today");
});

test("tiles count due soon, overdue and waiting correctly", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  const [sam] = await seed(token, "contacts", [{ display_name: "Sam" }]);
  await seed(token, "tasks", [
    { title: "Due today", owner_user_id: USER_ID, due_date: dayFromToday(0) },
    { title: "Due in a week", owner_user_id: USER_ID, due_date: dayFromToday(7) },
    { title: "Too far off", owner_user_id: USER_ID, due_date: dayFromToday(8) },
    { title: "Late", owner_user_id: USER_ID, due_date: dayFromToday(-2) },
    { title: "Sam's job", owner_contact_id: sam!.id, due_date: dayFromToday(-2) },
    { title: "Nobody's yet" },
    { title: "Finished", owner_user_id: USER_ID, due_date: dayFromToday(0), status: "done" },
  ]);

  await page.goto("/my-day");

  await expect(tile(page, "Due soon")).toContainText("2");
  await expect(tile(page, "Overdue")).toContainText("1");
  await expect(tile(page, "Waiting on others")).toContainText("1");

  const rows = page.getByRole("region", { name: "Your next actions" }).getByRole("listitem");
  await expect(rows.first()).toContainText("Late");
  await expect(rows.first()).toContainText("Overdue");
  await expect(page.getByRole("link", { name: /Sam's job/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Nobody's yet/ })).toContainText("Needs owner");
  await expect(page.getByRole("link", { name: /Finished/ })).toHaveCount(0);
  await expectNoViolations(page);
});

test("the dashboard shows five actions at most and links to the rest", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  await seed(token, "tasks", Array.from({ length: 7 }, (_, i) => ({ title: `Task ${i}`, owner_user_id: USER_ID, due_date: dayFromToday(i) })));

  await page.goto("/my-day");

  await expect(page.getByRole("region", { name: "Your next actions" }).getByRole("listitem")).toHaveCount(5);
  await page.getByRole("link", { name: "View all (7)" }).click();
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(7);
});

test("empty states offer one clear next step", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);

  await page.goto("/my-day");
  await expect(page.getByText("Nothing needs you right now")).toBeVisible();
  await expectNoViolations(page);

  await page.goto("/meetings");
  await expect(page.getByText("No meetings yet")).toBeVisible();

  await page.goto("/my-tasks");
  await expect(page.getByText("No open tasks")).toBeVisible();
  await expectNoViolations(page);
});

test("the task drawer marks done, reopens and logs activity", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  await seed(token, "tasks", [{ title: "Review pricing options", owner_user_id: USER_ID, due_date: dayFromToday(1) }]);
  await page.goto("/my-tasks");

  await page.getByRole("link", { name: /Review pricing options/ }).click();
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expect(drawer.getByText("Tomorrow", { exact: false })).toBeVisible();
  await expectNoViolations(page);

  await drawer.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByRole("main").getByText("No open tasks")).toBeVisible();

  await page.goto("/my-tasks?view=done");
  await page.getByRole("link", { name: /Review pricing options/ }).click();
  await expect(page.getByRole("dialog").getByText("Marked done")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Reopen" }).click();

  await page.goto("/my-tasks");
  await expect(page.getByRole("link", { name: /Review pricing options/ })).toBeVisible();
});

test("the drawer closes with Esc and returns to the list", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  await seed(token, "tasks", [{ title: "Close me", owner_user_id: USER_ID }]);
  await page.goto("/my-day");

  await page.getByRole("link", { name: /Close me/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL(/\/my-day$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("snoozing hides a task from next actions but not from the overdue count", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  await seed(token, "tasks", [{ title: "Late one", owner_user_id: USER_ID, due_date: dayFromToday(-1) }]);
  await page.goto("/my-day");

  await page.getByRole("link", { name: /Late one/ }).click();
  await page.getByLabel("Snooze until").fill(dayFromToday(3));
  await page.getByRole("button", { name: "Snooze", exact: true }).click();

  await expect(page.getByText("Nothing needs you right now")).toBeVisible();
  await expect(tile(page, "Overdue")).toContainText("1");

  await page.goto("/my-tasks");
  await expect(page.getByRole("link", { name: /Late one/ })).toContainText("Snoozed");
});

test("a task can go to someone else, reuses their name and shows as waiting", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);

  for (const [title, name] of [["First for Sam", "Sam"], ["Second for Sam", "sam"]] as const) {
    await page.goto("/tasks/new");
    await page.getByLabel("Task", { exact: true }).fill(title);
    await page.getByLabel("Owner").selectOption("other");
    await page.getByLabel("Their name").fill(name);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page).toHaveURL(/\/my-tasks$/);
  }

  await page.goto("/my-tasks?view=waiting");
  await expect(page.getByRole("link", { name: /First for Sam/ })).toContainText("Owner: Sam");
  await expect(page.getByRole("link", { name: /Second for Sam/ })).toContainText("Owner: Sam");
  await expect(page.getByRole("link", { name: /First for Sam/ })).toContainText("Waiting");
});

test("a task's details can be edited", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  await seed(token, "tasks", [{ title: "Old title", owner_user_id: USER_ID }]);
  await page.goto("/my-tasks");

  await page.getByRole("link", { name: /Old title/ }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByText("Edit details").click();
  await drawer.getByLabel("Task", { exact: true }).fill("New title");
  await drawer.getByLabel("Owner").selectOption("none");
  await drawer.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("link", { name: /New title/ })).toContainText("Needs owner");
});

test("forms refuse a blank meeting title and bad snooze date", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  await seed(token, "tasks", [{ title: "Pick a date", owner_user_id: USER_ID }]);

  await page.goto("/meetings/new");
  await page.getByLabel("Meeting title").fill("   ");
  await page.getByRole("button", { name: "Add meeting" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Add a meeting title.");

  await page.goto("/my-tasks");
  await page.getByRole("link", { name: /Pick a date/ }).click();
  await page.getByLabel("Snooze until").evaluate((input: HTMLInputElement) => input.removeAttribute("min"));
  await page.getByLabel("Snooze until").fill(dayFromToday(0));
  await page.getByRole("button", { name: "Snooze", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Choose a date after today.");
});

test.describe("notes", () => {
  test("upload a transcript and keep its words", async ({ page, context, baseURL }) => {
    await signInFresh(context, baseURL);
    await addMeeting(page, "Planning");

    await page.getByLabel("Or upload a file").setInputFiles({
      name: "call.vtt",
      mimeType: "text/vtt",
      buffer: Buffer.from("WEBVTT\n\n00:14:32.000 --> 00:14:36.000\nConfirm research interview slots"),
    });
    await page.getByRole("button", { name: "Add notes" }).click();

    await expect(page.getByRole("region", { name: "Meeting notes" })).toContainText("Confirm research interview slots");
    await expect(page.getByText("Transcript", { exact: true })).toBeVisible();
    await expect(page.getByText("Has timestamps")).toBeVisible();
  });

  test("refuse other file types and keep what was pasted", async ({ page, context, baseURL }) => {
    await signInFresh(context, baseURL);
    await addMeeting(page, "Planning");

    await page.getByLabel("Paste notes").fill("Keep me");
    await page.getByLabel("Or upload a file").setInputFiles({ name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await page.getByRole("button", { name: "Add notes" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Upload a .txt, .md, .vtt, .srt or .docx file.");
    await expect(page.getByLabel("Paste notes")).toHaveValue("Keep me");
  });

  test("refuse empty and oversized notes", async ({ page, context, baseURL }) => {
    await signInFresh(context, baseURL);
    await addMeeting(page, "Planning");

    await page.getByRole("button", { name: "Add notes" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Add some notes first.");

    await page.getByLabel("Paste notes").fill("x".repeat(100_001));
    await page.getByRole("button", { name: "Add notes" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Notes can be up to 100,000 characters.");
  });

  test("show notes as plain text, never as code", async ({ page, context, baseURL }) => {
    await signInFresh(context, baseURL);
    await addMeeting(page, "Planning");

    await page.getByLabel("Paste notes").fill('<img src=x onerror="window.hacked=true"><b>bold</b>');
    await page.getByRole("button", { name: "Add notes" }).click();

    await expect(page.getByRole("region", { name: "Meeting notes" })).toHaveText('<img src=x onerror="window.hacked=true"><b>bold</b>');
    expect(await page.evaluate(() => "hacked" in window)).toBe(false);
  });

  test("can be deleted after asking", async ({ page, context, baseURL }) => {
    await signInFresh(context, baseURL);
    await addMeeting(page, "Planning");
    await page.getByLabel("Paste notes").fill("Remove me");
    await page.getByRole("button", { name: "Add notes" }).click();
    await expect(page.getByRole("region", { name: "Meeting notes" })).toBeVisible();

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Delete notes" }).click();
    await expect(page.getByRole("region", { name: "Meeting notes" })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete notes" }).click();
    await expect(page.getByRole("region", { name: "Meeting notes" })).toHaveCount(0);
  });
});

test("editing and deleting a meeting keeps its tasks", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  const [meeting] = await seed(token, "meetings", [{ title: "Weekly check-in", starts_at: new Date().toISOString(), attendees: ["Maya", "Sam"] }]);
  await seed(token, "tasks", [{ title: "Survivor", owner_user_id: USER_ID, meeting_id: meeting!.id }]);

  await page.goto("/meetings");
  await page.getByRole("link", { name: /Weekly check-in/ }).click();
  await expect(page.getByText("With Maya, Sam")).toBeVisible();

  await page.getByRole("link", { name: "Edit meeting" }).click();
  await page.getByLabel("Meeting title").fill("Weekly sync");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Weekly sync" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete meeting" }).click();
  await expect(page).toHaveURL(/\/meetings$/);

  await page.goto("/my-tasks");
  await expect(page.getByRole("link", { name: /Survivor/ })).toBeVisible();
});

test("every signed-in screen fits a phone and uses the bottom bar", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const token = await signInFresh(context, baseURL);
  const [meeting] = await seed(token, "meetings", [{ title: "A long meeting title that keeps going and going for a while", starts_at: new Date().toISOString() }]);
  await seed(token, "tasks", [{ title: "A long task title that keeps going and going for quite a while indeed", owner_user_id: USER_ID, due_date: dayFromToday(-1), meeting_id: meeting!.id }]);

  for (const path of ["/my-day", "/my-tasks", "/meetings", "/settings", `/meetings/${meeting!.id}`, "/meetings/new", "/tasks/new"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
    await expectNoViolations(page);
  }

  const nav = page.getByRole("navigation", { name: "Main" });
  const box = await nav.boundingBox();
  expect(box!.y + box!.height).toBeCloseTo(740, 0);
  for (const link of await nav.getByRole("link").all()) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test("a missing or foreign task id doesn't break the page", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);

  await page.goto("/my-day?task=00000000-0000-4000-8000-00000000abcd");

  await expect(page.getByRole("dialog").getByText("We couldn't find this task.")).toBeVisible();
});

test("a missing meeting shows not found", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);

  await page.goto("/meetings/00000000-0000-4000-8000-00000000abcd");

  await expect(page.getByRole("heading", { level: 1, name: "We couldn't find that" })).toBeVisible();
  await page.getByRole("link", { name: "Go to My day" }).click();
  await expect(page).toHaveURL(/\/my-day$/);
});

test("the meetings list shows open actions and when the next one is due", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  const [meeting] = await seed(token, "meetings", [{ title: "Budget review", starts_at: new Date().toISOString() }]);
  const [quiet] = await seed(token, "meetings", [{ title: "Quiet chat", starts_at: new Date().toISOString() }]);
  await seed(token, "tasks", [
    { title: "Send figures", owner_user_id: USER_ID, meeting_id: meeting!.id, due_date: dayFromToday(1) },
    { title: "Book room", owner_user_id: USER_ID, meeting_id: meeting!.id },
    { title: "Done already", owner_user_id: USER_ID, meeting_id: meeting!.id, status: "done", due_date: dayFromToday(-4) },
    { title: "Old", owner_user_id: USER_ID, meeting_id: quiet!.id, due_date: dayFromToday(-2), status: "done" },
  ]);
  await page.goto("/meetings");
  await expect(page.getByRole("link", { name: /Budget review/ })).toContainText("2 open actions · next due Tomorrow");
  await expect(page.getByRole("link", { name: /Quiet chat/ })).not.toContainText("open action");
  await expectNoViolations(page);
});

test("a task can be deleted, after a confirm step", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  await seed(token, "tasks", [{ title: "Throw away", owner_user_id: USER_ID }, { title: "Keep me", owner_user_id: USER_ID }]);
  await page.goto("/my-tasks");
  await page.getByRole("link", { name: /Throw away/ }).click();
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expectNoViolations(page);
  await drawer.getByText("Delete task", { exact: true }).click();
  await drawer.getByRole("button", { name: "Delete this task" }).click();
  await expect(page.getByRole("link", { name: /Throw away/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Keep me/ })).toBeVisible();
});