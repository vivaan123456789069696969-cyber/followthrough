import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInFresh } from "./session";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function newMeeting(page: Page) {
  await page.goto("/meetings/new");
  await page.getByLabel("Meeting title").fill("Product sync");
  await page.getByRole("button", { name: "Add meeting" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Product sync" })).toBeVisible();
}

test("notes pasted from Wispr Flow are saved as Wispr Flow notes, words unchanged", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await newMeeting(page);

  await page.getByRole("radio", { name: "Wispr Flow" }).check();
  // Honest about the connection: information only, nothing to click.
  await expect(page.getByText("Direct connection to Wispr Flow", { exact: true })).toBeVisible();
  await expect(page.getByText("Coming after validation")).toBeVisible();
  await expect(page.getByRole("button", { name: /connect/i })).toHaveCount(0);
  await expect(page.getByText(/\bconnected\b/i)).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations).toEqual([]);

  await page.getByLabel("Paste notes from Wispr Flow").fill("14:32 Sam: Maya, can you send the brief by Thursday?");
  await page.getByRole("button", { name: "Import notes" }).click();

  const notes = page.getByRole("region", { name: "Meeting notes" });
  await expect(notes).toContainText("14:32 Sam: Maya, can you send the brief by Thursday?");
  await expect(page.getByText("Wispr Flow import")).toBeVisible();
});

test("a Wispr Flow file is imported the same way", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await newMeeting(page);

  await page.getByRole("radio", { name: "Wispr Flow" }).check();
  await page.getByLabel("Or upload a file").setInputFiles({
    name: "wispr-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("﻿Sam: I'll book the venue.\u0007"),
  });
  await page.getByRole("button", { name: "Import notes" }).click();

  await expect(page.getByRole("region", { name: "Meeting notes" })).toContainText("Sam: I'll book the venue.");
  await expect(page.getByText("Wispr Flow import")).toBeVisible();
});

test("an empty Wispr Flow import says what to do", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await newMeeting(page);
  await page.getByRole("radio", { name: "Wispr Flow" }).check();
  await page.getByRole("button", { name: "Import notes" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Add some notes first.");
});

test("the choice and pasted text survive a failed import", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await newMeeting(page);
  await page.getByRole("radio", { name: "Wispr Flow" }).check();
  await page.getByLabel("Paste notes from Wispr Flow").fill("Some notes");
  await page.getByLabel("Or upload a file").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
  await page.getByRole("button", { name: "Import notes" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Upload a .txt, .md, .vtt, .srt or .docx file.");
  await expect(page.getByRole("radio", { name: "Wispr Flow" })).toBeChecked();
  await expect(page.getByLabel("Paste notes from Wispr Flow")).toHaveValue("Some notes");
});

test("a hand-made form post can't pick the direct connection", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await newMeeting(page);
  await page.getByRole("radio", { name: "Wispr Flow" }).check();
  // Change the chosen option's value in the page, as a crafted request would.
  await page.getByRole("radio", { name: "Wispr Flow" }).evaluate((radio) => ((radio as HTMLInputElement).value = "wispr_api"));
  await page.getByLabel("Paste notes from Wispr Flow").fill("Some notes");
  await page.getByRole("button", { name: "Import notes" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Choose where these notes are from.");
});

test("setup shows Wispr Flow as import only, with the direct connection not available", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await page.goto("/settings");
  const sources = page.getByRole("region", { name: "Sources" });
  await expect(sources.getByText("Direct connection to Wispr Flow", { exact: true })).toBeVisible();
  await expect(sources.getByText("Coming after validation")).toBeVisible();
  await expect(sources.getByRole("button")).toHaveCount(0);
});

test("ordinary notes are still the default", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await newMeeting(page);
  await expect(page.getByRole("radio", { name: "Notes or a transcript" })).toBeChecked();
  await expect(page.getByText("Direct connection to Wispr Flow", { exact: true })).toHaveCount(0);
});
