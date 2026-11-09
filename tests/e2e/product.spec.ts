import { expect, test } from "@playwright/test";
import { signInFresh } from "./session";

// The product test from the master prompt, for the whole app:
// "After a meeting, can each person see their confirmed commitments and the next step?"
// One story, start to finish, the way a person would use it.

test.use({ timezoneId: "UTC" });

// Days named in the notes are two and three days ahead, never today: "by Thursday" said on a
// Thursday is ambiguous, and the app rightly asks instead of guessing. Computed in UTC, the
// timezone these tests sign in with.
const day = (daysAhead: number, options: Intl.DateTimeFormatOptions) =>
  new Date(Date.now() + daysAhead * 86_400_000).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
const briefDay = day(2, { weekday: "long" });
const pricingDay = day(3, { weekday: "long" });
const briefDate = day(2, { weekday: "long", month: "long", day: "numeric" });

// Scope: one signed-in person (Maya). Priya is someone Maya is waiting on, a name without an
// account, so "each person" means each owner's own view of what they committed to. Shared
// workspaces with several accounts aren't in this release. The stand-in for Claude here is
// simple; what the real model and checks do with tricky notes is covered by the extraction
// tests (tests/unit/extraction-golden.test.ts) and the paid `npm run test:ai`.

test("after a meeting, each person sees what they committed to, and what's next", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);

  // 1. A meeting happened. Maya adds it and pastes the notes.
  await page.goto("/meetings/new");
  await page.getByLabel("Meeting title").fill("Product sync");
  await page.getByRole("button", { name: "Add meeting" }).click();
  await page
    .getByLabel("Paste notes")
    .fill(
      [
        "Product sync",
        `14:32 Sam: Maya, can you send the revised launch brief by ${briefDay}?`,
        `14:35 Sam: Priya will update the pricing page by ${pricingDay}.`,
        "14:40 Sam: We should revisit onboarding.",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Add notes" }).click();
  await expect(page.getByRole("region", { name: "Meeting notes" })).toBeVisible();

  // 2. She asks for suggestions. The notes go to Claude only now, and she was told so.
  await expect(page.getByText("This sends these notes to Anthropic's Claude")).toBeVisible();
  await page.getByRole("button", { name: "Suggest actions" }).click();
  await expect(page).toHaveURL(/\/review\?note=/);

  // 3. Each suggestion shows the exact words behind it. Nothing is a task yet.
  const cards = page.locator("[data-suggestion]");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(`“Maya, can you send the revised launch brief by ${briefDay}?”`);
  await expect(cards.last()).toContainText(`“Priya will update the pricing page by ${pricingDay}.”`);
  await page.goto("/my-tasks");
  await expect(page.getByText("Send the revised launch brief")).toHaveCount(0);

  // 4. She checks and confirms both. The summary lists exactly what will be confirmed.
  await page.goBack();
  await page.getByRole("button", { name: "Confirm all complete (2)" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm 2 tasks?" });
  await expect(dialog).toContainText("Send the revised launch brief");
  await expect(dialog).toContainText("Update the pricing page");
  await dialog.getByRole("button", { name: "Confirm 2" }).click();
  await expect(page.getByRole("heading", { name: "All reviewed" })).toBeVisible();

  // 5. Maya's own view: her commitment is her next action, with its date and where it came from.
  await page.goto("/my-day");
  const next = page.getByRole("region", { name: "Your next actions" });
  await expect(next.getByRole("link", { name: /Send the revised launch brief/ })).toBeVisible();
  await expect(next.getByText("Update the pricing page")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Waiting on others/ })).toContainText("1");

  await next.getByRole("link", { name: /Send the revised launch brief/ }).click();
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expect(drawer).toContainText("Product sync");
  // Her date, worked out from the meeting's date and the word she heard, shown in full.
  await expect(drawer).toContainText(briefDate);
  await expect(drawer).toContainText(`“Maya, can you send the revised launch brief by ${briefDay}?”`);

  // 6. The source is one click away: the exact words, highlighted in the notes.
  await drawer.getByRole("link", { name: "Open in notes" }).click();
  await expect(page).toHaveURL(/\/review\?note=.*#quote-/);
  await expect(page.locator("mark[id^=quote-]").first()).toContainText(`Maya, can you send the revised launch brief by ${briefDay}?`);

  // 7. Priya's commitment is not Maya's to do, but she can see it and who owns it.
  await page.goto("/my-tasks?view=waiting");
  await expect(page.getByRole("link", { name: /Update the pricing page/ })).toContainText("Priya");

  // 8. Maya does hers. It leaves her next actions and moves to Done.
  await page.goto("/my-day");
  await page.getByRole("link", { name: /Send the revised launch brief/ }).click();
  await page.getByRole("dialog", { name: "Task details" }).getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByRole("region", { name: "Your next actions" }).getByText("Send the revised launch brief")).toHaveCount(0);
  await page.goto("/my-tasks?view=done");
  await expect(page.getByRole("link", { name: /Send the revised launch brief/ })).toBeVisible();

  // 9. Nothing was made up: the idea nobody owned was never turned into a task.
  await page.goto("/my-tasks");
  await expect(page.getByText("revisit onboarding")).toHaveCount(0);
});
