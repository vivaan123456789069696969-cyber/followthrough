"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Renders nothing. Saves the browser's timezone at first sign-in, then redraws with the
 * right dates. It tries once per page load and only redraws after a real save, so a
 * timezone the server can't accept can't cause a loop.
 */
export function TimezoneSync({ save }: { save: (timezone: string) => Promise<boolean> }) {
  const router = useRouter();
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    save(Intl.DateTimeFormat().resolvedOptions().timeZone)
      .then((saved) => {
        if (saved) router.refresh();
      })
      .catch(() => {
        // Tried again on the next page load.
      });
  }, [save, router]);

  return null;
}
