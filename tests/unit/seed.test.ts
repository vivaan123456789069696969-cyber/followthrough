// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildDemo, DEMO_TITLE } from "../../scripts/seed-data.mjs";

describe("the demo scenario", () => {
  // 2030-06-05 is a Wednesday, so the meeting was Tuesday 4 June and "Thursday" is 6 June.
  const demo = buildDemo("2030-06-05");

  it("is the deck's Product sync with Maya Chen", () => {
    expect(demo.meeting.title).toBe(DEMO_TITLE);
    expect(demo.meeting.startsAt).toBe("2030-06-04T14:30:00Z");
    expect(demo.confirmed[0]).toMatchObject({ title: "Send revised launch brief", ownerName: "Maya Chen", dueDate: "2030-06-06", basis: "by Thursday" });
  });

  it("gives every task and suggestion a quote that is really in the notes, at the stated place", () => {
    for (const item of [...demo.confirmed, ...demo.pending]) {
      const characters = Array.from(demo.notes);
      expect(characters.slice(item.locator.start, item.locator.end).join("")).toBe(item.quote);
    }
  });

  it("names a timestamp for each quote taken from a timed line", () => {
    expect(demo.confirmed[0]!.locator).toMatchObject({ type: "timestamp", value: "14:32" });
  });

  it("never invents an owner or a date: what the notes don't say is left blank", () => {
    const venue = demo.pending.find((item) => item.title.startsWith("Book a venue"))!;
    expect(venue).toMatchObject({ ownerName: null, dueDate: null });
    expect(venue.questions).toContain("Who is doing this?");
    // The one date comes with the words that gave it.
    for (const item of [...demo.confirmed, ...demo.pending]) if (item.dueDate) expect(item.basis).not.toBeNull();
  });

  it("is built around any day, including across a month end", () => {
    expect(buildDemo("2030-06-30").confirmed[0]!.dueDate).toBe("2030-07-04");
  });
});
