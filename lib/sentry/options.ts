import { scrubEvent } from "./scrub";

/**
 * Error reporting settings, shared by the server and the browser. Without a DSN nothing is
 * reported at all. With one, only scrubbed errors are sent: no performance data, no
 * breadcrumbs, no session replay, no personal data.
 */
export function sentryOptions(dsn: string | undefined) {
  return {
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    sendClientReports: false,
    // The last check before anything leaves.
    beforeSend: <T extends object>(event: T): T => scrubEvent(event),
    // Performance data isn't sent at all.
    beforeSendTransaction: () => null,
  };
}

/** The address errors are sent to, for the browser's content security policy. Null when off. */
export function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    // A URL's origin leaves out the key part of the address, so it's safe to put in a header.
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
