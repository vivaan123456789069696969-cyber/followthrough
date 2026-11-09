import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { dayFromToday, seed, setSession, signInFresh, USER_ID } from "./session";

// WCAG 2.2 level AA, every screen, in light and dark, on a phone and on a desktop.
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: Page, where: string) {
  // Let fonts and streamed parts settle, so the scan sees the finished page.
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
  expect(summary, `${where} has accessibility problems`).toEqual([]);
}

async function noSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${where} scrolls sideways`).toBeLessThanOrEqual(1);
}

/** A person with a meeting, notes, suggestions waiting, and tasks of every kind. */
async function populate(context: BrowserContext, baseURL: string | undefined) {
  const token = await signInFresh(context, baseURL);
  const [sam] = await seed(token, "contacts", [{ display_name: "Sam" }]);
  const [meeting] = await seed(token, "meetings", [{ title: "Product sync", starts_at: new Date().toISOString() }]);
  const notes = "14:32 Sam: Maya, can you send the revised launch brief by Thursday?\n14:35 Priya: I'll update the pricing page.";
  const [note] = await seed(token, "meeting_notes", [{ meeting_id: meeting!.id, raw_text: notes, source_format: "paste", has_timestamps: true }]);
  const quote = "I'll update the pricing page.";
  const start = notes.indexOf(quote);
  await seed(token, "suggestions", [
    {
      note_id: note!.id,
      title: "Update the pricing page",
      owner_name: null,
      due_date: null,
      due_date_basis: null,
      source_quote: quote,
      source_locator: { type: "timestamp", value: "14:35", start, end: start + quote.length, line: 2 },
      confidence: "high",
      open_questions: ["Who is doing this?"],
      status: "pending",
      model: "test",
    },
  ]);
  const tasks = await seed(token, "tasks", [
    { title: "Overdue task", owner_user_id: USER_ID, due_date: dayFromToday(-3), meeting_id: meeting!.id },
    { title: "Due today", owner_user_id: USER_ID, due_date: dayFromToday(0) },
    { title: "Due soon", owner_user_id: USER_ID, due_date: dayFromToday(3) },
    { title: "Needs an owner", due_date: dayFromToday(5) },
    { title: "Waiting on Sam", owner_contact_id: sam!.id, due_date: dayFromToday(2) },
    { title: "Finished task", owner_user_id: USER_ID, status: "done" },
  ]);
  return { meetingId: meeting!.id, noteId: note!.id, taskId: tasks[0]!.id };
}

test("the checker really does catch problems, so a clean sweep means something", async ({ page }) => {
  await page.setContent(
    `<!doctype html><html lang="en"><head><title>Broken</title></head><body><main>
      <h1>Broken page</h1><img src="x.png"><button></button>
      <p style="color:#bbb;background:#fff">Pale text</p>
      <a href="#" style="display:inline-block;width:8px;height:8px"></a>
    </main></body></html>`,
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const found = results.violations.map((violation) => violation.id);
  for (const expected of ["image-alt", "button-name", "color-contrast", "link-name"]) expect(found).toContain(expected);
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme });
    test.setTimeout(150_000);

    test("public pages", async ({ page }) => {
      for (const path of [
        "/",
        "/sign-in",
        "/unsubscribe?u=00000000-0000-4000-8000-000000000001&s=x",
        "/unsubscribe?done=1",
        "/unsubscribe?invalid=1",
      ]) {
        await page.goto(path);
        await scan(page, path);
        await noSidewaysScroll(page, path);
      }
    });

    test("every signed-in screen", async ({ page, context, baseURL }) => {
      const { meetingId, noteId, taskId } = await populate(context, baseURL);
      const paths = [
        "/my-day",
        `/my-day?task=${taskId}`,
        "/my-tasks",
        `/my-tasks?task=${taskId}`,
        "/my-tasks?view=waiting",
        "/my-tasks?view=done",
        "/meetings",
        "/meetings/new",
        `/meetings/${meetingId}`,
        `/meetings/${meetingId}?task=${taskId}`,
        `/meetings/${meetingId}/edit`,
        `/meetings/${meetingId}/review?note=${noteId}`,
        "/tasks/new",
        "/settings",
        "/settings#reminders-heading",
        // A page that isn't there.
        "/meetings/00000000-0000-4000-8000-0000000000aa",
      ];
      for (const path of paths) {
        await page.goto(path);
        await scan(page, path);
        await noSidewaysScroll(page, path);
      }
    });

    test("setup", async ({ page, context, baseURL }) => {
      await setSession(context, baseURL, `good-new${randomUUID().replace(/-/g, "")}`);
      await page.goto("/setup");
      await scan(page, "/setup");
      await noSidewaysScroll(page, "/setup");
    });

    test("dialogs that open on a page", async ({ page, context, baseURL }) => {
      const { noteId, meetingId } = await populate(context, baseURL);
      await page.goto("/settings");
      await page.getByRole("button", { name: "Delete account" }).click();
      await scan(page, "delete account dialog");

      await page.goto(`/meetings/${meetingId}/review?note=${noteId}`);
      await page.locator("[data-suggestion]").first().getByRole("button", { name: "Edit details" }).click();
      await scan(page, "a suggestion being edited");
    });
  });
}

test.describe("small screens", () => {
  test("nothing scrolls sideways at 320 pixels wide, the width of 400% zoom", async ({ page, context, baseURL }) => {
    const { meetingId, noteId } = await populate(context, baseURL);
    await page.setViewportSize({ width: 320, height: 700 });
    for (const path of ["/my-day", "/my-tasks", "/meetings", `/meetings/${meetingId}`, `/meetings/${meetingId}/review?note=${noteId}`, "/settings", "/tasks/new"]) {
      await page.goto(path);
      await noSidewaysScroll(page, `${path} at 320px`);
    }
  });
});

test.describe("keyboard", () => {
  test("the first Tab offers to skip the menu, and Enter lands on the page content", async ({ page, context, baseURL }) => {
    await populate(context, baseURL);
    await page.goto("/my-day");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("main-content");
    // The next Tab goes into the page, not back into the menu.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("nav") !== null)).toBe(false);
  });

  test("a focused control is never hidden behind the phone's bottom bar", async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, "The fixed bottom bar is only on phones");
    await populate(context, baseURL);
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/my-tasks");

    const hidden: string[] = [];
    for (let press = 0; press < 40; press++) {
      await page.keyboard.press("Tab");
      const state = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        const nav = document.querySelector("nav[aria-label='Main']");
        if (!element || element === document.body || !nav || element.closest("nav")) return null;
        const box = element.getBoundingClientRect();
        const bar = nav.getBoundingClientRect();
        return { name: (element.textContent || element.tagName).trim().slice(0, 40), bottom: box.bottom, barTop: bar.top, height: box.height };
      });
      if (state && state.height > 0 && state.bottom > state.barTop + 1) hidden.push(`${state.name} (bottom ${Math.round(state.bottom)} under bar at ${Math.round(state.barTop)})`);
    }
    expect(hidden).toEqual([]);
  });

  test("with reduced motion on, nothing animates or fades", async ({ page, context, baseURL }) => {
    await populate(context, baseURL);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/my-day");
    const longest = await page.evaluate(() => {
      let longest = 0;
      for (const element of document.querySelectorAll("*")) {
        const style = getComputedStyle(element);
        for (const value of [style.transitionDuration, style.animationDuration]) {
          for (const part of value.split(",")) {
            const seconds = parseFloat(part) / (part.trim().endsWith("ms") ? 1000 : 1);
            if (Number.isFinite(seconds)) longest = Math.max(longest, seconds);
          }
        }
      }
      return longest;
    });
    expect(longest).toBeLessThan(0.001);
  });

  test("every page has one main area and one first-level heading", async ({ page, context, baseURL }) => {
    const { meetingId } = await populate(context, baseURL);
    for (const path of ["/my-day", "/my-tasks", "/meetings", `/meetings/${meetingId}`, "/settings", "/tasks/new", "/meetings/new"]) {
      await page.goto(path);
      await expect(page.getByRole("main"), `${path} main`).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 }), `${path} h1`).toHaveCount(1);
    }
  });
});
