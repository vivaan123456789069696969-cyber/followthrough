"use client";

import { primaryButton } from "@/components/button-styles";
import { useReportError } from "@/components/report-error";

/** Keeps the menu in place when something on a page fails, so the user can move on. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportError(error);
  return (
    <main className="flex flex-col items-start gap-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Something didn&apos;t work</h1>
      <p className="text-ink-muted">That last step may not have saved. Check your connection and try again.</p>
      <button type="button" onClick={reset} className={primaryButton}>
        Try again
      </button>
    </main>
  );
}
