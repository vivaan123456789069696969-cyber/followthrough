// The demo scenario from the concept deck: Maya Chen after a Product sync. Pure, so it can
// be tested. scripts/seed.mjs writes it to the dev database.

export const DEMO_TITLE = "Product sync (demo)";

const NOTES = [
  "Product sync",
  "14:30 Sam: Thanks everyone. Let's go through launch.",
  "14:32 Sam: Maya, can you send the revised launch brief by Thursday?",
  "14:35 Priya: I'll update the pricing page next week.",
  "14:38 Sam: We should book a venue for the launch event.",
  "14:41 Maya: I'll check the budget with finance tomorrow.",
].join("\n");

const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const nextWeekday = (from, weekday) => {
  const ahead = (weekday - new Date(`${from}T00:00:00Z`).getUTCDay() + 7) % 7 || 7;
  return addDays(from, ahead);
};

/** Characters, not UTF-16 units, as the database counts. */
function span(quote) {
  const at = NOTES.indexOf(quote);
  if (at === -1) throw new Error(`quote not in the notes: ${quote}`);
  const start = Array.from(NOTES.slice(0, at)).length;
  const line = NOTES.slice(0, at).split("\n").length;
  const time = /^(\d{1,2}:\d{2}) /.exec(NOTES.split("\n")[line - 1])?.[1] ?? null;
  return { type: time ? "timestamp" : "offset", value: time, start, end: start + Array.from(quote).length, line };
}

/**
 * @param today the local date (YYYY-MM-DD) to build the scenario around
 * @returns the meeting, its notes, two people, and what to confirm or leave pending
 */
export function buildDemo(today) {
  const meetingDate = addDays(today, -1);
  const thursday = nextWeekday(meetingDate, 4);
  const quotes = {
    brief: "Maya, can you send the revised launch brief by Thursday?",
    pricing: "I'll update the pricing page next week.",
    venue: "We should book a venue for the launch event.",
    budget: "I'll check the budget with finance tomorrow.",
  };
  return {
    // Only people who own a task; Sam is in the meeting but has nothing to do.
    contacts: ["Priya Nair"],
    meeting: { title: DEMO_TITLE, startsAt: `${meetingDate}T14:30:00Z`, attendees: ["Sam Lee", "Priya Nair"] },
    notes: NOTES,
    // Confirmed: these become tasks, with their quotes, like after a real review.
    confirmed: [
      { title: "Send revised launch brief", owner: "me", ownerName: "Maya Chen", dueDate: thursday, basis: "by Thursday", quote: quotes.brief, locator: span(quotes.brief) },
      { title: "Update pricing page", owner: "Priya Nair", ownerName: "Priya Nair", dueDate: null, basis: null, quote: quotes.pricing, locator: span(quotes.pricing) },
    ],
    // Waiting for review: one with nothing missing apart from the date, one with no owner or date.
    pending: [
      { title: "Check the budget with finance", ownerName: "Maya Chen", dueDate: null, basis: null, quote: quotes.budget, locator: span(quotes.budget), questions: ["When is this due?"] },
      { title: "Book a venue for the launch event", ownerName: null, dueDate: null, basis: null, quote: quotes.venue, locator: span(quotes.venue), questions: ["Who is doing this?"] },
    ],
  };
}
