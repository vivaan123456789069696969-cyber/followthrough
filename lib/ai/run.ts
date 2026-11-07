import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ActionsSchema, FALLBACK_MODELS, MAX_OUTPUT_TOKENS, SYSTEM_PROMPT, userMessage, type ModelOutput } from "./prompt";

export type ExtractionInput = { notes: string; meetingTitle: string; meetingDate: string; attendees: string[] };

/**
 * usageKnown is false when the request may have been billed but no usage came back
 * (a timeout or dropped connection). The caller then keeps the worst-case charge.
 */
type Usage = { model: string; inputTokens: number; outputTokens: number; usageKnown: boolean };

export type ExtractionResult =
  | ({ ok: true; actions: ModelOutput["actions"] } & Usage)
  | ({ ok: false; reason: "refused" | "too_long" | "rate_limited" | "unavailable" | "failed" } & Usage);

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Asks Claude for commitments. Used by the app and by the live evaluation tests. */
export async function runExtraction(
  client: Anthropic,
  input: ExtractionInput,
  options: { model: string; effort: Effort },
): Promise<ExtractionResult> {
  const { model, effort } = options;
  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage(input) }],
      output_config: { effort, format: betaZodOutputFormat(ActionsSchema) },
      ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    const usage = {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      usageKnown: true,
    };
    if (response.stop_reason === "refusal") return { ok: false, reason: "refused", ...usage };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "too_long", ...usage };
    if (!response.parsed_output) return { ok: false, reason: "failed", ...usage };
    return { ok: true, actions: response.parsed_output.actions, ...usage };
  } catch (error) {
    // Only the error's type is logged. Messages can contain model output, which quotes the notes.
    const name = error instanceof Error ? error.constructor.name : typeof error;
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    console.error(JSON.stringify({ event: "extraction_error", name, status }));

    // An error response from the API means no answer was generated, so nothing was billed.
    const notBilled = { model, inputTokens: 0, outputTokens: 0, usageKnown: true };
    const unknown = { model, inputTokens: 0, outputTokens: 0, usageKnown: false };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, reason: "rate_limited", ...notBilled };
    if (error instanceof Anthropic.APIConnectionError) return { ok: false, reason: "unavailable", ...unknown };
    if (error instanceof Anthropic.InternalServerError) return { ok: false, reason: "unavailable", ...notBilled };
    if (error instanceof Anthropic.APIError) return { ok: false, reason: "failed", ...notBilled };
    return { ok: false, reason: "failed", ...unknown };
  }
}
