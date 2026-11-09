"use client";

import "./globals.css";
import { useReportError } from "@/components/report-error";

/**
 * The last resort: shown if the page shell itself fails, where nothing else can render.
 * It replaces the whole page, so it carries its own html and body.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportError(error);
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
          <p className="text-base font-semibold tracking-tight text-brand">followthrough</p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Something went wrong</h1>
          <p className="text-ink-muted">The app couldn&apos;t load. Your work is safe. Try again in a moment.</p>
          <div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-base font-medium text-on-brand hover:opacity-90"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
