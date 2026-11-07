import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { runExtraction, type ExtractionInput } from "./run";

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"] as const);
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
}

function aiEffort(): Effort {
  const configured = process.env.ANTHROPIC_EFFORT as Effort | undefined;
  return configured && EFFORTS.has(configured) ? configured : "medium";
}

/** Only ever called after the user asks for suggestions on a note. */
export function extractActions(input: ExtractionInput) {
  // The key stays on the server: this module can't be imported by browser code.
  // One retry, inside the page's 300-second limit. 8,000 output tokens take well under 240 seconds.
  const client = new Anthropic({ timeout: 240_000, maxRetries: 1 });
  return runExtraction(client, input, { model: aiModel(), effort: aiEffort() });
}

export function monthlyCapUsd(): number {
  const cap = Number(process.env.AI_MONTHLY_CAP_USD);
  return Number.isFinite(cap) && cap >= 0 ? cap : 5;
}

/** Optional limit on everyone's spending together, per month. Unset means no shared limit. */
export function globalCapUsd(): number | null {
  const raw = process.env.AI_GLOBAL_MONTHLY_CAP_USD;
  const cap = Number(raw);
  return raw && Number.isFinite(cap) && cap >= 0 ? cap : null;
}

export function hourlyLimit(): number {
  const limit = Number(process.env.AI_HOURLY_LIMIT);
  return Number.isInteger(limit) && limit > 0 ? limit : 10;
}
