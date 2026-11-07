// Calls to Google with a timeout and retries for rate limits and temporary errors.
// Never logs bodies: they can contain tokens or the user's calendar and task text.
import "server-only";

export class GoogleError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`google_${status}_${reason}`);
  }
}

/** A calendar or list the app relies on was deleted in Google. Settings can make or pick another. */
export class ContainerGone extends Error {
  constructor(readonly kind: "calendar" | "tasklist") {
    super(`google_${kind}_gone`);
  }
}

/**
 * The kinds of failure the app shows to people, in plain words. `willRetry` is false once
 * automatic tries have run out, so the message never promises a retry that won't happen.
 */
export function plainError(error: unknown, willRetry = true): string {
  const later = willRetry ? " This will be tried again." : " Sending stopped after several tries. Press Retry.";
  if (error instanceof ReconnectNeeded) return "Google needs you to connect again in Settings.";
  if (error instanceof ContainerGone) {
    return error.kind === "calendar"
      ? "The FollowThrough calendar was deleted in Google. Make it again in Settings."
      : "The Google Tasks list was deleted. Choose a list in Settings.";
  }
  if (error instanceof GoogleError) {
    if (error.status === 429 || error.status === 503) return `Google is busy.${later}`;
    if (error.status === 403) return "Google refused this. Check the connection in Settings.";
  }
  return `This couldn't be sent to Google.${later}`;
}

/** The refresh token stopped working: the user removed access or it expired. */
export class ReconnectNeeded extends Error {
  constructor() {
    super("google_reconnect_needed");
  }
}

type Fetch = typeof fetch;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function googleFetch(
  url: string,
  init: RequestInit & { retries?: number; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  const { retries = 2, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), ...request } = init;
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, { ...request, signal: AbortSignal.timeout(10_000) });
    if (!RETRYABLE.has(response.status) || attempt >= retries) return response;
    // Exponential backoff with jitter, honouring Retry-After when Google sends one.
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.random() * 250;
    await sleep(Math.min(wait, 5000));
  }
}

/** Reads a JSON reply, or throws a GoogleError with Google's short reason code. */
export async function googleJson<T>(response: Response): Promise<T> {
  if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T;
  let reason = "error";
  try {
    const body = (await response.json()) as { error?: string | { status?: string; errors?: { reason?: string }[] } };
    if (typeof body.error === "string") reason = body.error;
    else reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? reason;
  } catch {
    // No JSON body; the status says enough.
  }
  throw new GoogleError(response.status, reason.replace(/[^\w.-]/g, "").slice(0, 60));
}
