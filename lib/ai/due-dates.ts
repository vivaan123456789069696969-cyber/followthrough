// Turns the date words people say in meetings into a calendar date, deterministically.
// Anything unclear comes back as a question instead of a guess.

import { addDays, isCalendarDate } from "@/lib/tasks/dates";

export type DueResult = { date: string } | { question: string } | null;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function monthIndex(word: string): number {
  const lower = word.toLowerCase().replace(/\.$/, "");
  const full = MONTHS.indexOf(lower);
  if (full !== -1) return full;
  const short = SHORT_MONTHS.indexOf(lower.slice(0, 3));
  return lower.length >= 3 && short !== -1 && MONTHS[short]!.startsWith(lower) ? short : -1;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Wording that shifts or points back from the obvious date. Always asked, never guessed. */
const SHIFTED = /\b(next week|following|after next|a week from|weeks? from|last|past|previous|ago|before|day after|week after|month after)\b/;

function readable(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function lastDayOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

/** A month and day with no year: this year if still ahead, otherwise unclear. */
function monthDay(meeting: string, month: number, day: number, phrase: string): DueResult {
  const year = Number(meeting.slice(0, 4));
  const date = `${year}-${pad(month + 1)}-${pad(day)}`;
  if (!isCalendarDate(date)) return { question: unclear(phrase) };
  if (date < meeting) return { question: `Which year does “${phrase}” mean?` };
  return { date };
}

const unclear = (phrase: string) => `Which date does “${phrase}” mean?`;

/**
 * @param phrase exact words from the notes, such as "by Thursday" or "end of month"
 * @param meeting the meeting's calendar date in the user's timezone (YYYY-MM-DD)
 */
export function resolveDuePhrase(phrase: string | null, meeting: string): DueResult {
  if (!phrase) return null;
  const text = phrase.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  const said = phrase.trim();

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return isCalendarDate(iso[0]) ? { date: iso[0] } : { question: unclear(said) };

  if (SHIFTED.test(text)) return { question: unclear(said) };

  // "EOD Friday" is Friday, so a named weekday wins over "end of day".
  const hasWeekday = new RegExp(`\\b(${WEEKDAYS.join("|")})\\b`).test(text);
  if (!hasWeekday && /\b(today|tonight|end of (the )?day|eod)\b/.test(text)) return { date: meeting };
  if (!hasWeekday && /\btomorrow\b/.test(text)) return { date: addDays(meeting, 1) };
  if (/\b(end of (the )?month|eom)\b/.test(text)) return { date: lastDayOfMonth(meeting) };

  if (/\b(end of (the )?week|eow)\b/.test(text)) {
    const weekday = weekdayOf(meeting);
    if (weekday === 0 || weekday === 6) return { question: "Which week does “end of the week” mean?" };
    return { date: addDays(meeting, 5 - weekday) };
  }

  const inDays = /\bin (\d{1,2}|a|one|two|three) (day|days|week|weeks)\b/.exec(text);
  if (inDays) {
    const amount = ({ a: 1, one: 1, two: 2, three: 3 } as Record<string, number>)[inDays[1]!] ?? Number(inDays[1]);
    return { date: addDays(meeting, inDays[2]!.startsWith("week") ? amount * 7 : amount) };
  }

  const weekdayMatch = new RegExp(`\\b(next |this )?(${WEEKDAYS.join("|")})\\b`).exec(text);
  if (weekdayMatch) {
    const target = WEEKDAYS.indexOf(weekdayMatch[2]!);
    const today = weekdayOf(meeting);
    const ahead = (target - today + 7) % 7;
    const name = weekdayMatch[2]!.charAt(0).toUpperCase() + weekdayMatch[2]!.slice(1);

    if (weekdayMatch[1] === "next ") {
      const soon = addDays(meeting, ahead === 0 ? 7 : ahead);
      return { question: `Does “next ${name}” mean ${readable(soon)} or ${readable(addDays(soon, 7))}?` };
    }
    if (ahead === 0) return { question: `Does “${name}” mean today or ${readable(addDays(meeting, 7))}?` };
    return { date: addDays(meeting, ahead) };
  }

  const monthFirst = /\b([a-z]{3,9})\.? (\d{1,2})(st|nd|rd|th)?\b/.exec(text);
  if (monthFirst && monthIndex(monthFirst[1]!) !== -1) return monthDay(meeting, monthIndex(monthFirst[1]!), Number(monthFirst[2]), said);

  const dayFirst = /\b(\d{1,2})(st|nd|rd|th)? (of )?([a-z]{3,9})\b/.exec(text);
  if (dayFirst && monthIndex(dayFirst[4]!) !== -1) return monthDay(meeting, monthIndex(dayFirst[4]!), Number(dayFirst[1]), said);

  const numeric = /\b(\d{1,2})\/(\d{1,2})\b/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    if (first > 12 && second <= 12) return monthDay(meeting, second - 1, first, said);
    if (second > 12 && first <= 12) return monthDay(meeting, first - 1, second, said);
    return { question: `Does “${numeric[0]}” mean month/day or day/month?` };
  }

  if (/\bnext month\b/.test(text)) return { question: `Which day does “${said}” mean?` };

  return { question: unclear(said) };
}
