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
      {profile && !profile.timezone ? <TimezoneSync save={saveDetectedTimezone} /> : null}
      <AppNav />
      <div className="w-full min-w-0 flex-1 px-4 pt-6 pb-24 sm:px-8 md:pb-10">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
