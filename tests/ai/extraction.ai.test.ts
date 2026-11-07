// @vitest-environment node
//
// Runs the golden notes through the real model, then through the app's checks, and
// asserts what the user would see. It costs real money (roughly $1 for all cases on
// Opus 5.5), so it never runs in npm test.
//
//   npm run test:ai
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { checkModelActions } from "@/lib/ai/postprocess";
import { runExtraction } from "@/lib/ai/run";
import { GOLDEN_CASES } from "../fixtures/extraction";

if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY in .env.local to run the live extraction tests.");

const client = new Anthropic();
const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

describe.each(GOLDEN_CASES)("$name (live)", (golden) => {
  it("gives the expected suggestions with nothing invented", async () => {
    const result = await runExtraction(
      client,
      { notes: golden.notes, meetingTitle: golden.notes.split("\n")[0]!, meetingDate: golden.meetingDate, attendees: golden.attendees },
      { model, effort: "medium" },
    );
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    if (!result.ok) return;

    const { suggestions } = checkModelActions(golden.notes, result.actions, golden.meetingDate);
    expect(suggestions).toHaveLength(golden.expect.count);

    for (const expected of golden.expect.items ?? []) {
      const match = suggestions.find((suggestion) => suggestion.source_quote.toLowerCase().includes(expected.titleIncludes.split(" ")[0]!.toLowerCase()) || suggestion.title.toLowerCase().includes(expected.titleIncludes));
      expect(match, expected.titleIncludes).toBeDefined();
      expect(match!.owner_name?.toLowerCase() ?? null).toBe(expected.owner?.toLowerCase() ?? null);
      expect(match!.due_date).toBe(expected.due);
    }
    for (const forbidden of golden.expect.noTitleIncludes ?? []) {
      expect(suggestions.some((suggestion) => suggestion.title.includes(forbidden))).toBe(false);
    }
  });
});
