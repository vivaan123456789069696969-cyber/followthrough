"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Renders nothing. Saves the browser's timezone at first sign-in, then redraws with the right dates. */
export function TimezoneSync({ save }: { save: (timezone: string) => Promise<void> }) {
  const router = useRouter();

  useEffect(() => {
    save(Intl.DateTimeFormat().resolvedOptions().timeZone)
      .then(() => router.refresh())
      .catch(() => {
        // Tried again on the next page load.
      });
  }, [save, router]);

  return null;
}
