"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Reports an error shown by an error page. Scrubbed before it leaves, and nothing at all when reporting is off. */
export function useReportError(error: Error & { digest?: string }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
}
