export const DEMO_TITLE: string;

type Locator = { type: "timestamp" | "offset"; value: string | null; start: number; end: number; line: number };

export function buildDemo(today: string): {
  contacts: string[];
  meeting: { title: string; startsAt: string; attendees: string[] };
  notes: string;
  confirmed: { title: string; owner: string; ownerName: string; dueDate: string | null; basis: string | null; quote: string; locator: Locator }[];
  pending: { title: string; ownerName: string | null; dueDate: string | null; basis: string | null; quote: string; locator: Locator; questions: string[] }[];
};
