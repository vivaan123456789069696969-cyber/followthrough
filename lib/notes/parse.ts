export const NOTE_FORMATS = ["txt", "md", "vtt", "srt", "docx"] as const;
export type FileNoteFormat = (typeof NOTE_FORMATS)[number];

/** Vercel rejects larger request bodies, and notes this large would be over the text cap anyway. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function maxNoteChars(): number {
  const configured = Number(process.env.MAX_NOTE_CHARS);
  // The database enforces 100,000 too, so the setting can only lower it.
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 100_000) : 100_000;
}

/** Counted the way Postgres counts, by character rather than by UTF-16 unit. */
export const charCount = (text: string) => [...text].length;

export function formatFromFileName(name: string): FileNoteFormat | null {
  const extension = name.toLowerCase().split(".").pop();
  return NOTE_FORMATS.find((format) => format === extension) ?? null;
}

const TIMESTAMP_PATTERNS = [
  /\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/, // VTT and SRT cues
  /^\s*[[(]?\d{1,2}:\d{2}(:\d{2})?[\])]?\s/m, // "14:32 Maya: ..." at the start of a line
];

export function hasTimestamps(text: string): boolean {
  return TIMESTAMP_PATTERNS.some((pattern) => pattern.test(text));
}

export type ParsedNote = { ok: true; text: string; hasTimestamps: boolean } | { ok: false; message: string };

/** Keeps the words exactly as given, because source quotes must match them later. */
export function validateNoteText(raw: string): ParsedNote {
  const text = raw.replace(/^﻿/, "");
  if (text.includes("\u0000")) return { ok: false, message: "This file doesn't look like text." };
  if (text.trim().length === 0) return { ok: false, message: "Add some notes first." };

  const limit = maxNoteChars();
  if (charCount(text) > limit) {
    return { ok: false, message: `Notes can be up to ${limit.toLocaleString("en-US")} characters.` };
  }
  return { ok: true, text, hasTimestamps: hasTimestamps(text) };
}

export async function parseNoteFile(name: string, bytes: ArrayBuffer): Promise<ParsedNote & { format?: FileNoteFormat }> {
  const format = formatFromFileName(name);
  if (!format) return { ok: false, message: "Upload a .txt, .md, .vtt, .srt or .docx file." };
  if (bytes.byteLength === 0) return { ok: false, message: "This file is empty." };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, message: "This file is too large. The limit is 4 MB." };

  let text: string;
  if (format === "docx") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = result.value;
    } catch {
      return { ok: false, message: "We couldn't read this Word file." };
    }
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, message: "This file isn't saved as UTF-8 text. Save it as UTF-8 and try again." };
    }
  }

  const parsed = validateNoteText(text);
  return parsed.ok ? { ...parsed, format } : parsed;
}
