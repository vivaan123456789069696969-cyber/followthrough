import type { ReactNode } from "react";
import { secondaryButton } from "@/components/button-styles";
import { TimezoneSync } from "@/components/timezone-sync";
import { getProfile, requireSession } from "@/lib/auth/session";
import { saveDetectedTimezone, signOut } from "./actions";

// Private pages are rendered per request, whatever settings the build ran with.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const profile = await getProfile(session);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 sm:px-8">
      {profile && !profile.timezone ? <TimezoneSync save={saveDetectedTimezone} /> : null}
      <header className="flex items-center justify-between py-4">
        <p className="text-base font-semibold tracking-tight text-brand">followthrough</p>
        <form action={signOut}>
          <button type="submit" className={secondaryButton}>
            Sign out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
