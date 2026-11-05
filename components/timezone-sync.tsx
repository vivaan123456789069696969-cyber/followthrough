"use client";

import { useEffect } from "react";

/** Renders nothing. Saves the browser's timezone the first time a user signs in. */
export function TimezoneSync({ save }: { save: (timezone: string) => Promise<void> }) {
  useEffect(() => {
    void save(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [save]);

  return null;
}
