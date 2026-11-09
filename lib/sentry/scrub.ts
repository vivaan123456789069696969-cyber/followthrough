// What may leave the app in an error report. Meeting notes, task text, names and email
// addresses must never be in one, so the report is rebuilt from scratch with only a few
// safe parts, rather than trimmed down from the original.

type Loose = Record<string, unknown>;

/**
 * Only code-like messages pass: letters, digits and _ : . - / with no spaces. Our own codes
 * look like "integration_load_failed:42P01". A sentence, a title or a phrase from someone's
 * notes has spaces and is replaced.
 */
const CODE_LIKE = /^[A-Za-z0-9_:.\-/]{1,80}$/;

export function safeMessage(message: unknown): string {
  return typeof message === "string" && CODE_LIKE.test(message) ? message : "[redacted]";
}

const SAFE_TEXT = /^[A-Za-z0-9_.\-/ ]{1,100}$/;
const keep = (value: unknown) => (typeof value === "string" && SAFE_TEXT.test(value) ? value : undefined);

/** Keeps the error's type and where it happened. Nothing else of the original gets through. */
export function scrubEvent<T extends object>(event: T): T {
  const original = event as Loose;
  const exception = original.exception as { values?: Loose[] } | undefined;

  const next: Loose = {
    event_id: keep(original.event_id),
    timestamp: typeof original.timestamp === "number" ? original.timestamp : undefined,
    level: keep(original.level),
    platform: keep(original.platform),
    release: keep(original.release),
    environment: keep(original.environment),
  };
  if (original.message !== undefined) next.message = safeMessage(original.message);

  if (exception?.values) {
    next.exception = {
      values: exception.values.map((value) => ({
        type: keep(value.type) ?? "Error",
        value: safeMessage(value.value),
        // The code locations are kept; the variables around them (which can hold text) are not.
        stacktrace: value.stacktrace
          ? {
              frames: ((value.stacktrace as { frames?: Loose[] }).frames ?? []).map((frame) => ({
                filename: keep(frame.filename) ?? keep(frame.abs_path),
                function: keep(frame.function),
                lineno: typeof frame.lineno === "number" ? frame.lineno : undefined,
                colno: typeof frame.colno === "number" ? frame.colno : undefined,
                in_app: typeof frame.in_app === "boolean" ? frame.in_app : undefined,
              })),
            }
          : undefined,
      })),
    };
  }
  return JSON.parse(JSON.stringify(next)) as T;
}
