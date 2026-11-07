import type { ReactNode } from "react";

// Private pages are rendered per request, whatever settings the build ran with.
export const dynamic = "force-dynamic";

/** Setup has no navigation, so the one task on screen is choosing or skipping. */
export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh px-4 py-8 sm:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <p className="text-base font-semibold tracking-tight text-brand">followthrough</p>
        {children}
      </div>
    </div>
  );
}
