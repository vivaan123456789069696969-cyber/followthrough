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
  // "14:32 Maya: ..." at the start of a line. Only spaces and tabs, never newlines, so
  // a note of blank lines can't make this scan for seconds.
  /^[ \t]*[[(]?\d{1,2}:\d{2}(:\d{2})?[\])]?[ \t]/m,
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
  // A string can't have fewer characters than half its UTF-16 length, so this is safe to
  // reject before counting, which would copy a huge string.
  if (text.length > 2 * limit || charCount(text) > limit) {
    return { ok: false, message: `Notes can be up to ${limit.toLocaleString("en-US")} characters.` };
  }
  return { ok: true, text, hasTimestamps: hasTimestamps(text) };
}

const MAX_DOCX_ENTRIES = 200;
const MAX_DOCX_UNPACKED_BYTES = 20 * 1024 * 1024;

/**
 * A .docx is a zip. A small one can unpack to gigabytes and exhaust the server's memory,
 * so check the sizes the zip declares before letting the Word reader unpack anything.
 */
export async function docxIsSafeToOpen(bytes: ArrayBuffer): Promise<boolean> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files);
    if (entries.length > MAX_DOCX_ENTRIES) return false;

    let total = 0;
    for (const entry of entries) {
      if (entry.dir) continue;
      // JSZip reads each entry's declared size from the zip's index without unpacking it.
      const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (typeof declared !== "number") return false;
      total += declared;
      if (total > MAX_DOCX_UNPACKED_BYTES) return false;
    }
    return true;
  } catch {
    // Not a readable zip. The Word reader reports that with its own message.
    return true;
  }
}

export async function parseNoteFile(name: string, bytes: ArrayBuffer): Promise<ParsedNote & { format?: FileNoteFormat }> {
  const format = formatFromFileName(name);
  if (!format) return { ok: false, message: "Upload a .txt, .md, .vtt, .srt or .docx file." };
  if (bytes.byteLength === 0) return { ok: false, message: "This file is empty." };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, message: "This file is too large. The limit is 4 MB." };

  let text: string;
  if (format === "docx") {
    if (!(await docxIsSafeToOpen(bytes))) {
      return { ok: false, message: "This Word file is too large to read." };
    }
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
