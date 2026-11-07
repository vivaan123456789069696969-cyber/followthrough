import { describe, expect, it } from "vitest";
import { resolveDuePhrase } from "@/lib/ai/due-dates";
import { buildSegments, findQuote, locatorFor } from "@/lib/ai/text";

describe("findQuote", () => {
  const raw = "14:32 Sam: Maya, can you send the\nrevised   launch brief by Thursday?";

  it("finds the exact span, ignoring case and spacing", () => {
    const span = findQuote(raw, "maya, can you send the revised launch brief by thursday?");
    expect(span).not.toBeNull();
    expect(raw.slice(span!.start, span!.end)).toBe("Maya, can you send the\nrevised   launch brief by Thursday?");
  });

  it.each([
    ["a paraphrase", "Maya will send the launch brief"],
    ["a word changed", "Maya, can you send the revised launch plan by Thursday?"],
    ["something too short to trust", "Maya"],
    ["empty", ""],
  ])("returns nothing for %s", (_name, quote) => {
    expect(findQuote(raw, quote)).toBeNull();
  });

  it("finds non-English text", () => {
    const notes = "माया, क्या आप गुरुवार तक लॉन्च ब्रीफ भेज सकती हैं?";
    expect(findQuote(notes, "क्या आप गुरुवार तक लॉन्च ब्रीफ")).not.toBeNull();
  });
});

describe("locators", () => {
  it("uses a timestamp at the start of the line", () => {
    const raw = "Intro\n14:32 Sam: Maya, can you send it?";
    const segments = buildSegments(raw);
    const start = raw.indexOf("Maya");
    expect(locatorFor(raw, segments, start, start + 10)).toMatchObject({ type: "timestamp", value: "14:32", line: 2 });
    expect(segments[1]!.speaker).toBe("Sam");
  });

  it("uses the cue time for lines in a VTT transcript", () => {
    const raw = "WEBVTT\n\n00:14:32.000 --> 00:14:36.000\nMaya, can you send it?";
    const start = raw.indexOf("Maya");
    expect(locatorFor(raw, buildSegments(raw), start, start + 10)).toMatchObject({ type: "timestamp", value: "14:32" });
  });

  it("falls back to an offset and line number with no times", () => {
    const raw = "First line\nMaya will send it.";
    const start = raw.indexOf("Maya");
    expect(locatorFor(raw, buildSegments(raw), start, start + 10)).toEqual({ type: "offset", value: null, start, end: start + 10, line: 2 });
  });
});

describe("resolveDuePhrase", () => {
  const tuesday = "2026-10-20"; // as in the concept deck

  it.each([
    ["by Thursday", "2026-10-22"],
    ["this Friday", "2026-10-23"],
    ["on Monday", "2026-10-26"],
    ["today", tuesday],
    ["by end of day", tuesday],
    ["tomorrow", "2026-10-21"],
    ["by end of the week", "2026-10-23"],
    ["end of month", "2026-10-31"],
    ["in 3 days", "2026-10-23"],
    ["in two weeks", "2026-11-03"],
    ["by Oct 30", "2026-10-30"],
    ["October 30th", "2026-10-30"],
    ["the 30th of October", "2026-10-30"],
    ["by 2026-11-05", "2026-11-05"],
    ["by 30/10", "2026-10-30"],
    ["by 10/30", "2026-10-30"],
  ])("reads %j as %s", (phrase, date) => {
    expect(resolveDuePhrase(phrase, tuesday)).toEqual({ date });
  });

  it("crosses a month boundary", () => {
    expect(resolveDuePhrase("by Monday", "2026-10-29")).toEqual({ date: "2026-11-02" });
    expect(resolveDuePhrase("end of month", "2026-12-15")).toEqual({ date: "2026-12-31" });
    expect(resolveDuePhrase("end of month", "2028-02-10")).toEqual({ date: "2028-02-29" });
  });

  it.each([
    ["next Friday", "Does “next Friday” mean Fri, Oct 23 or Fri, Oct 30?"],
    ["Tuesday", "Does “Tuesday” mean today or Tue, Oct 27?"],
    ["next week", "Which date does “next week” mean?"],
    ["by 5/6", "Does “5/6” mean month/day or day/month?"],
    ["by March 3", "Which year does “by March 3” mean?"],
    ["soon", "Which date does “soon” mean?"],
    ["ASAP", "Which date does “ASAP” mean?"],
  ])("asks instead of guessing for %j", (phrase, question) => {
    expect(resolveDuePhrase(phrase, tuesday)).toEqual({ question });
  });

  it("asks which week on a weekend meeting", () => {
    expect(resolveDuePhrase("end of week", "2026-10-24")).toEqual({ question: "Which week does “end of the week” mean?" });
  });

  it("returns nothing without a phrase", () => {
    expect(resolveDuePhrase(null, tuesday)).toBeNull();
  });

  it("asks about impossible dates instead of dropping them", () => {
    expect(resolveDuePhrase("by Feb 30", tuesday)).toEqual({ question: "Which date does “by Feb 30” mean?" });
  });
});
