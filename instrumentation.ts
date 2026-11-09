import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry/options";

/** Starts error reporting on the server. Does nothing without SENTRY_DSN. */
export function register() {
  Sentry.init(sentryOptions(process.env.SENTRY_DSN));
}

/** Errors thrown while rendering or in server actions, reported (scrubbed) when reporting is on. */
export const onRequestError = Sentry.captureRequestError;
