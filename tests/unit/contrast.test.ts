// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) {
    tokens[match[1]!] = match[2]!;
  }
  return tokens;
}

const lightBlock = /:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const darkBlock = /prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? "";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const textPairs: [string, string][] = [
  ["ink", "sage-50"],
  ["ink", "sage-100"],
  ["ink", "surface"],
  ["ink-muted", "sage-50"],
  ["ink-muted", "sage-100"],
  ["ink-muted", "surface"],
  ["brand", "sage-50"],
  ["brand", "sage-100"],
  ["brand", "surface"],
  ["on-brand", "brand"],
  ["on-brand-deep", "brand-deep"],
  ["on-lime", "lime"],
  ["on-warm", "warm"],
  ["on-lilac", "lilac"],
];

describe.each([
  ["light", tokensIn(lightBlock)],
  ["dark", tokensIn(darkBlock)],
])("%s theme tokens", (_name, tokens) => {
  it.each(textPairs)("%s on %s meets WCAG AA (4.5:1)", (text, background) => {
    expect(tokens[text], `missing --${text}`).toBeDefined();
    expect(tokens[background], `missing --${background}`).toBeDefined();
    expect(contrast(tokens[text]!, tokens[background]!)).toBeGreaterThanOrEqual(4.5);
  });
});
