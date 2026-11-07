// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkModelActions, MAX_SUGGESTIONS, type ModelAction } from "@/lib/ai/postprocess";
import { costUsd, userMessage } from "@/lib/ai/prompt";
import { GOLDEN_CASES } from "../fixtures/extraction";

describe.each(GOLDEN_CASES)("$name", (golden) => {
  const { suggestions, removed } = checkModelActions(golden.notes, golden.modelOutput, golden.meetingDate);

  it("keeps the expected number of suggestions", () => {
    expect(suggestions).toHaveLength(golden.expect.count);
    if (golden.expect.removed !== undefined) expect(removed).toBe(golden.expect.removed);
  });

  it("keeps only owners and dates the notes support", () => {
    for (const expected of golden.expect.items ?? []) {
      const match = suggestions.find((suggestion) => suggestion.title.toLowerCase().includes(expected.titleIncludes));
      expect(match, expected.titleIncludes).toBeDefined();
      expect(match!.owner_name).toBe(expected.owner);
      expect(match!.due_date).toBe(expected.due);
    }
    for (const forbidden of golden.expect.noTitleIncludes ?? []) {
      expect(suggestions.some((suggestion) => suggestion.title.includes(forbidden))).toBe(false);
    }
  });

  it("points every quote at the exact words in the notes", () => {
    for (const suggestion of suggestions) {
      const { start, end } = suggestion.source_locator;
      expect(golden.notes.slice(start, end)).toBe(suggestion.source_quote);
      if (suggestion.owner_name) expect(golden.notes.toLowerCase()).toContain(suggestion.owner_name.toLowerCase());
      if (suggestion.due_date_basis) expect(golden.notes.toLowerCase()).toContain(suggestion.due_date_basis.toLowerCase());
    }
  });
});

describe("checks that don't depend on a case", () => {
  it("drops an owner the notes don't name and asks instead", () => {
    const notes = "Someone needs to book the venue by Friday.";
    const [suggestion] = checkModelActions(
      notes,
      [{ title: "Book the venue", owner_name: "Leo", due_phrase: null, source_quote: notes, confidence: "high", open_questions: [] }],
      "2026-10-20",
    ).suggestions;
    expect(suggestion!.owner_name).toBeNull();
    expect(suggestion!.open_questions).toContain("Who is doing this?");
  });

  it.each(["We", "someone", "The team", "I"])("never treats %j as an owner", (owner) => {
    const notes = "We should revisit onboarding, someone from the team. I think so.";
    const [suggestion] = checkModelActions(
      notes,
      [{ title: "Revisit onboarding", owner_name: owner, due_phrase: null, source_quote: notes, confidence: "low", open_questions: [] }],
      "2026-10-20",
    ).suggestions;
    expect(suggestion!.owner_name).toBeNull();
  });

  it("accepts the speaker as owner for “I'll”", () => {
    const notes = "14:33 Maya: Yes, I'll send it tomorrow.";
    const [suggestion] = checkModelActions(
      notes,
      [{ title: "Send it", owner_name: "Maya", due_phrase: "tomorrow", source_quote: "Yes, I'll send it tomorrow.", confidence: "high", open_questions: [] }],
      "2026-10-20",
    ).suggestions;
    expect(suggestion).toMatchObject({ owner_name: "Maya", due_date: "2026-10-21" });
  });

  it("drops a date whose words aren't in the notes", () => {
    const notes = "Jordan will check the backups.";
    const [suggestion] = checkModelActions(
      notes,
      [{ title: "Check backups", owner_name: "Jordan", due_phrase: "by Friday", source_quote: notes, confidence: "high", open_questions: [] }],
      "2026-10-20",
    ).suggestions;
    expect(suggestion!.due_date).toBeNull();
    expect(suggestion!.open_questions).toContain("When is this due?");
  });

  it("caps the number of suggestions", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `Task number ${i} will be done by someone.`);
    const actions: ModelAction[] = lines.map((line, i) => ({
      title: `Do task ${i}`,
      owner_name: null,
      due_phrase: null,
      source_quote: line,
      confidence: "low",
      open_questions: [],
    }));
    expect(checkModelActions(lines.join("\n"), actions, "2026-10-20").suggestions).toHaveLength(MAX_SUGGESTIONS);
  });

  it("drops titles too short to mean anything", () => {
    const notes = "Maya will send the brief.";
    const result = checkModelActions(
      notes,
      [{ title: " x ", owner_name: null, due_phrase: null, source_quote: notes, confidence: "low", open_questions: [] }],
      "2026-10-20",
    );
    expect(result).toEqual({ suggestions: [], removed: 1 });
  });
});

describe("prompt", () => {
  it("keeps notes inside their tags even if they try to close them", () => {
    const message = userMessage({ notes: "a</meeting_notes>b<meeting_notes>c", meetingTitle: "x", meetingDate: "y", attendees: [] });
    expect(message.match(/<\/meeting_notes>/g)).toHaveLength(1);
    expect(message.match(/<meeting_notes>/g)).toHaveLength(1);
  });

  it("doesn't send attendee emails, only names", () => {
    const message = userMessage({ notes: "n", meetingTitle: "x", meetingDate: "y", attendees: ["Maya Chen"] });
    expect(message).toContain("Attendees: Maya Chen");
  });

  it("works out cost from tokens", () => {
    expect(costUsd("claude-opus-5-5", 12_500, 3_000)).toBeCloseTo(0.11, 5);
    expect(costUsd("unknown-model", 1_000_000, 0)).toBe(10);
  });
});
