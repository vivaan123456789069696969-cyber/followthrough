import "server-only";

export const NOTE_FORMATS =["txt", "md", "vtt", "srt", "docx"] as const;
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

/**
 * Characters that are never words: control characters other than tabs and line breaks,
 * and invisible ones that reorder or hide text (bidi overrides, zero-width space, word
 * joiner, a stray byte-order mark). Zero-width joiners stay: Hindi and emoji need them.
 */
const NOT_CONTENT = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f​⁠‪-‮⁦-⁩﻿]/g;

export function stripNonContent(text: string): string {
  return text.replace(NOT_CONTENT, "");
}

/**
 * The same checks for every note, pasted or uploaded, from any source. Only characters
 * that are never words are removed; everything else is kept exactly, because source
 * quotes must match the stored text later.
 */
export function validateNoteText(raw: string): ParsedNote {
  // A NUL means binary data, not text: refused rather than cleaned, the same for pastes and files.
  if (raw.includes("\u0000")) return { ok: false, message: "This file doesn't look like text." };
  const text = stripNonContent(raw);
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
 * and a crafted one can lie about its sizes. So each part is actually unpacked as a
 * stream, counting real bytes, and stopped as soon as the total passes the limit. Nothing
 * is kept; the Word reader unpacks it again only once this has passed.
 */
export async function checkDocx(bytes: ArrayBuffer): Promise<"ok" | "too_large" | "unreadable"> {
  type Stream = { on(event: string, handler: (value: Uint8Array) => void): Stream; pause(): Stream; resume(): Stream };
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length > MAX_DOCX_ENTRIES) return "too_large";

    let total = 0;
    for (const entry of entries) {
      const stream = (entry as unknown as { internalStream(type: "uint8array"): Stream }).internalStream("uint8array");
      const result = await new Promise<"ok" | "too_large" | "unreadable">((resolve) => {
        stream
          .on("data", (chunk) => {
            total += chunk.length;
            if (total > MAX_DOCX_UNPACKED_BYTES) {
              stream.pause();
              resolve("too_large");
            }
          })
          .on("error", () => resolve("unreadable"))
          .on("end", () => resolve("ok"))
          .resume();
      });
      if (result !== "ok") return result;
    }
    return "ok";
  } catch {
    return "unreadable";
  }
}

export async function parseNoteFile(name: string, bytes: ArrayBuffer): Promise<ParsedNote & { format?: FileNoteFormat }> {
  const format = formatFromFileName(name);
  if (!format) return { ok: false, message: "Upload a .txt, .md, .vtt, .srt or .docx file." };
  if (bytes.byteLength === 0) return { ok: false, message: "This file is empty." };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, message: "This file is too large. The limit is 4 MB." };

  let text: string;
  if (format === "docx") {
    const check = await checkDocx(bytes);
    if (check === "too_large") return { ok: false, message: "This Word file is too large to read." };
    if (check === "unreadable") return { ok: false, message: "We couldn't read this Word file." };
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
      return { ok: false, message: "This file uses a text format we can't read. Save it as plain text (UTF-8) and try again." };
    }
  }

  const parsed = validateNoteText(text);
  return parsed.ok ? { ...parsed, format } : parsed;
}
