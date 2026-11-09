import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { TimezoneSync } from "@/components/timezone-sync";
import { getAppContext } from "@/lib/data/context";
import { saveDetectedTimezone } from "./actions";

// Private pages are rendered per request, whatever settings the build ran with.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Cached for the request, so pages reuse this session and profile.
  const { profile } = await getAppContext();
  // New accounts see setup once. Finishing or skipping it both count.
  if (profile && !profile.onboarding_done) redirect("/setup");

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* First stop for keyboard users: jumps past the menu, which repeats on every page. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-3 focus:text-on-brand"
      >
        Skip to main content
      </a>
      {profile && !profile.timezone ? <TimezoneSync save={saveDetectedTimezone} /> : null}
      <AppNav />
      <div className="w-full min-w-0 flex-1 px-4 pt-6 pb-24 sm:px-8 md:pb-10">
        <div id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl focus:outline-none">
          {children}
        </div>
      </div>
    </div>
  );
}
