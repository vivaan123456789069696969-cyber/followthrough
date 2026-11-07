// Finding the model's quotes in the original notes, and labelling where they are.
// Everything here works on the notes exactly as stored, so offsets point into raw_text.

export type Segment = { start: number; end: number; timestamp: string | null; speaker: string | null };

const CUE = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)(?:[.,]\d{3})?\s*-->/;
const PREFIX = /^\s*[[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?[ \t]+/;
const SPEAKER = /^\s*(?:[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?[ \t]+)?([\p{L}][\p{L}\p{M} .'-]{0,40}?):[ \t]/u;

/** One segment per line, with the latest timestamp seen (VTT and SRT cues apply to the lines after them). */
export function buildSegments(raw: string): Segment[] {
  const segments: Segment[] = [];
  let cueTime: string | null = null;
  let start = 0;

  for (const line of raw.split("\n")) {
    const end = start + line.length;
    const cue = CUE.exec(line);
    if (cue) {
      cueTime = trimHours(cue[1]!);
    } else {
      const prefix = PREFIX.exec(line);
      const speaker = SPEAKER.exec(line);
      segments.push({
        start,
        end,
        timestamp: prefix ? trimHours(prefix[1]!) : cueTime,
        speaker: speaker ? speaker[1]!.trim() : null,
      });
    }
    start = end + 1;
  }
  return segments;
}

/** "00:14:32" reads as "14:32", the way people say it. */
function trimHours(time: string): string {
  return time.replace(/^0{1,2}:(?=\d{2}:\d{2}$)/, "");
}

/**
 * Finds a quote in the notes, ignoring differences in case and spacing, and returns its
 * exact span in the original text. Returns null when the words aren't there.
 */
export function findQuote(raw: string, quote: string): { start: number; end: number } | null {
  const wanted = collapse(quote).normalized;
  if (wanted.length < 8) return null;

  const { normalized, map } = collapse(raw);
  const at = normalized.indexOf(wanted);
  if (at === -1) return null;

  return { start: map[at]!, end: map[at + wanted.length - 1]! + 1 };
}

/** Lowercase with every run of whitespace as one space, and where each character came from. */
function collapse(text: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let lastWasSpace = true;

  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    if (/\s/.test(character)) {
      if (!lastWasSpace) {
        normalized += " ";
        map.push(i);
      }
      lastWasSpace = true;
    } else {
      // Some characters get longer when lowercased ("İ"), so each new unit maps back to i.
      const lower = character.toLowerCase();
      normalized += lower;
      for (let unit = 0; unit < lower.length; unit++) map.push(i);
      lastWasSpace = false;
    }
  }
  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }
  return { normalized, map };
}

export function segmentAt(segments: Segment[], offset: number): Segment | null {
  return segments.find((segment) => offset >= segment.start && offset <= segment.end) ?? null;
}

export type Locator = { type: "timestamp" | "offset"; value: string | null; start: number; end: number; line: number };

export function locatorFor(raw: string, segments: Segment[], start: number, end: number): Locator {
  const segment = segmentAt(segments, start);
  const line = raw.slice(0, start).split("\n").length;
  return segment?.timestamp
    ? { type: "timestamp", value: segment.timestamp, start, end, line }
    : { type: "offset", value: null, start, end, line };
}

/** True when the phrase is in the text as whole words, ignoring case and spacing. "Ann" is not in "planning". */
export function containsPhrase(text: string, phrase: string): boolean {
  const wanted = collapse(phrase).normalized;
  if (!wanted) return false;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(collapse(text).normalized);
}

/**
 * JavaScript counts an emoji as two units; Postgres counts it as one character.
 * Stored offsets count characters, so both sides agree.
 */
export function toCharacterOffset(text: string, unitOffset: number): number {
  return Array.from(text.slice(0, unitOffset)).length;
}

/** Cuts text to a number of characters without splitting an emoji. */
export function truncateCharacters(text: string, length: number): string {
  const characters = Array.from(text);
  return characters.length > length ? characters.slice(0, length).join("") : text;
}
