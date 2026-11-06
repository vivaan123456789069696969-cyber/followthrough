// @vitest-environment node
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { charCount, formatFromFileName, hasTimestamps, parseNoteFile, validateNoteText } from "@/lib/notes/parse";

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

async function docx(paragraph: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const out = await zip.generateAsync({ type: "uint8array" });
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

describe("formatFromFileName", () => {
  it.each([
    ["notes.txt", "txt"],
    ["NOTES.MD", "md"],
    ["call.vtt", "vtt"],
    ["call.srt", "srt"],
    ["brief.final.docx", "docx"],
    ["virus.exe", null],
    ["report.pdf", null],
    ["noextension", null],
  ])("%s is %s", (name, expected) => {
    expect(formatFromFileName(name)).toBe(expected);
  });
});

describe("hasTimestamps", () => {
  it.each([
    ["00:14:32.000 --> 00:14:36.000\nMaya, can you send it?"],
    ["00:14:32,000 --> 00:14:36,000\nMaya, can you send it?"],
    ["14:32 Maya, can you send it?"],
    ["[14:32] Maya, can you send it?"],
    ["Intro\n01:02:03 Sam: thanks"],
  ])("finds them in %j", (text) => {
    expect(hasTimestamps(text)).toBe(true);
  });

  it.each(["We met at 14:32 and talked.", "Budget ratio is 2:1 this year.", "No times here."])("finds none in %j", (text) => {
    expect(hasTimestamps(text)).toBe(false);
  });
});

describe("validateNoteText", () => {
  it("keeps the words exactly, including spacing and line breaks", () => {
    const text = "  Maya,  can you\r\nsend it?\n\n";
    expect(validateNoteText(text)).toEqual({ ok: true, text, hasTimestamps: false });
  });

  it("removes only a byte order mark", () => {
    expect(validateNoteText("﻿Hello")).toMatchObject({ ok: true, text: "Hello" });
  });

  it.each(["", "   \n  "])("rejects empty notes %j", (text) => {
    expect(validateNoteText(text)).toEqual({ ok: false, message: "Add some notes first." });
  });

  it("accepts exactly the limit and rejects one more", () => {
    expect(validateNoteText("x".repeat(100_000)).ok).toBe(true);
    expect(validateNoteText("x".repeat(100_001))).toEqual({ ok: false, message: "Notes can be up to 100,000 characters." });
  });

  it("counts emoji as one character, like the database", () => {
    expect(charCount("😀a")).toBe(2);
    expect(validateNoteText("😀".repeat(100_000)).ok).toBe(true);
  });

  it("keeps non-English text", () => {
    expect(validateNoteText("माया, क्या आप भेज सकती हैं?")).toMatchObject({ ok: true, text: "माया, क्या आप भेज सकती हैं?" });
  });
});

describe("parseNoteFile", () => {
  it("reads a text file", async () => {
    expect(await parseNoteFile("notes.txt", bytes("Maya, send it"))).toMatchObject({ ok: true, text: "Maya, send it", format: "txt" });
  });

  it("reads a transcript and finds its timestamps", async () => {
    const parsed = await parseNoteFile("call.vtt", bytes("WEBVTT\n\n00:14:32.000 --> 00:14:36.000\nMaya, send it"));
    expect(parsed).toMatchObject({ ok: true, hasTimestamps: true, format: "vtt" });
  });

  it("reads a Word file", async () => {
    expect(await parseNoteFile("notes.docx", await docx("Maya, send it"))).toMatchObject({ ok: true, format: "docx" });
    const parsed = await parseNoteFile("notes.docx", await docx("Maya, send it"));
    expect(parsed.ok && parsed.text.trim()).toBe("Maya, send it");
  });

  it("rejects a damaged Word file", async () => {
    expect(await parseNoteFile("notes.docx", bytes("not a zip"))).toEqual({ ok: false, message: "We couldn't read this Word file." });
  });

  it("rejects other file types", async () => {
    expect(await parseNoteFile("virus.exe", bytes("x"))).toEqual({ ok: false, message: "Upload a .txt, .md, .vtt, .srt or .docx file." });
  });

  it("rejects an empty file", async () => {
    expect(await parseNoteFile("notes.txt", new ArrayBuffer(0))).toEqual({ ok: false, message: "This file is empty." });
  });

  it("rejects a file over the upload limit", async () => {
    expect(await parseNoteFile("notes.txt", new ArrayBuffer(4 * 1024 * 1024 + 1))).toEqual({
      ok: false,
      message: "This file is too large. The limit is 4 MB.",
    });
  });

  it("rejects text that isn't UTF-8", async () => {
    const parsed = await parseNoteFile("notes.txt", new Uint8Array([0xff, 0xfe, 0x41, 0x00]).buffer as ArrayBuffer);
    expect(parsed.ok).toBe(false);
  });

  it("rejects a binary file with a text name", async () => {
    expect(await parseNoteFile("notes.txt", new Uint8Array([0x41, 0x00, 0x42]).buffer as ArrayBuffer)).toEqual({
      ok: false,
      message: "This file doesn't look like text.",
    });
  });
});
