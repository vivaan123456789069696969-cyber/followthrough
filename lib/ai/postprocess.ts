// Checks everything the model returned before any of it is shown to the user.
// The model only suggests. This decides what is true about the notes.

import { resolveDuePhrase } from "./due-dates";
import {
  buildSegments,
  containsPhrase,
  findQuote,
  locatorFor,
  segmentAt,
  toCharacterOffset,
  truncateCharacters,
  type Locator,
  type Segment,
} from "./text";

export const MAX_SUGGESTIONS = 30;

export type ModelAction = {
  title: string;
  owner_name: string | null;
  due_phrase: string | null;
  source_quote: string;
  confidence: "high" | "medium" | "low";
  open_questions: string[];
};

export type CheckedSuggestion = {
  title: string;
  owner_name: string | null;
  due_date: string | null;
  due_date_basis: string | null;
  source_quote: string;
  source_locator: Locator;
  confidence: "high" | "medium" | "low";
  open_questions: string[];
};

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** Words that point at a group or nobody in particular, never at one person. */
const NOT_A_PERSON = new Set(["we", "us", "you", "i", "me", "they", "them", "someone", "somebody", "anyone", "everyone", "team", "the team", "all", "nobody"]);

const FIRST_PERSON = /(^|[^\p{L}])(i['’]ll|i will|i can|i['’]m going to|i am going to|i['’]m on it|let me)([^\p{L}]|$)/iu;

/**
 * An owner counts only if the quote names them, or they are speaking and the
 * quote says "I'll" or similar. "Sam: Priya will send it" is Priya's, not Sam's.
 */
function checkedOwner(name: string, quote: string, speaker: string | null): string | null {
  if (!name || NOT_A_PERSON.has(name.toLowerCase())) return null;
  if (containsPhrase(quote, name)) return name;
  if (speaker && speaker.toLowerCase() === name.toLowerCase() && FIRST_PERSON.test(quote)) return name;
  return null;
}

/** The quote's own lines plus one line either side: where a due date may come from. */
function textAround(raw: string, segments: Segment[], start: number, end: number): string {
  const first = segments.findIndex((segment) => end > segment.start && start <= segment.end);
  if (first === -1) return raw.slice(start, end);
  let last = first;
  while (last + 1 < segments.length && segments[last + 1]!.start < end) last += 1;
  const from = segments[Math.max(0, first - 1)]!.start;
  const to = segments[Math.min(segments.length - 1, last + 1)]!.end;
  return raw.slice(from, to);
}

function overlaps(a: Locator, b: Locator): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * @param raw the notes exactly as stored
 * @param meetingDate the meeting's date in the user's timezone, for "Thursday" and the like
 */
export function checkModelActions(raw: string, actions: ModelAction[], meetingDate: string) {
  const segments = buildSegments(raw);
  const kept: CheckedSuggestion[] = [];
  let removed = 0;

  for (const action of actions) {
    const title = clean(action.title);
    const span = findQuote(raw, action.source_quote);
    // Without its words in the notes, a suggestion can't be shown at all.
    if (!span || title.length < 3) {
      removed += 1;
      continue;
    }

    const quote = raw.slice(span.start, span.end);
    const locator = locatorFor(raw, segments, span.start, span.end);
    const questions = (action.open_questions ?? []).map(clean).filter(Boolean).slice(0, 3);

    const proposedOwner = clean(action.owner_name);
    const owner = checkedOwner(proposedOwner, quote, segmentAt(segments, span.start)?.speaker ?? null);
    if (!owner) questions.push("Who is doing this?");

    // A due date needs its own words in the notes, in the quote or the line either side.
    let dueDate: string | null = null;
    let basis: string | null = null;
    const phrase = clean(action.due_phrase);
    if (phrase && containsPhrase(textAround(raw, segments, span.start, span.end), phrase)) {
      const resolved = resolveDuePhrase(phrase, meetingDate);
      if (resolved && "date" in resolved) {
        dueDate = resolved.date;
        basis = phrase;
      } else if (resolved) {
        questions.push(resolved.question);
      }
    } else if (phrase) {
      questions.push("When is this due?");
    }

    const suggestion: CheckedSuggestion = {
      title: truncateCharacters(title, 140),
      owner_name: owner,
      due_date: dueDate,
      due_date_basis: basis,
      source_quote: quote,
      // Stored offsets count characters, as the database does.
      source_locator: { ...locator, start: toCharacterOffset(raw, span.start), end: toCharacterOffset(raw, span.end) },
      confidence: action.confidence,
      open_questions: [...new Set(questions)].slice(0, 3),
    };

    // The same commitment mentioned twice, or the same words used twice, shows once.
    const duplicate = kept.some(
      (other) => overlaps(other.source_locator, suggestion.source_locator) || other.title.toLowerCase() === suggestion.title.toLowerCase(),
    );
    if (duplicate) continue;

    kept.push(suggestion);
    if (kept.length === MAX_SUGGESTIONS) break;
  }

  return { suggestions: kept, removed };
}
