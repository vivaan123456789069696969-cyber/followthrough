import type { Metadata } from "next";
import { secondaryButton } from "@/components/button-styles";
import { Card } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";
import { signOut } from "../actions";

export const metadata: Metadata = { title: "Settings · FollowThrough" };

export default async function SettingsPage() {
  const context = await getAppContext();
  const name = context.profile?.full_name || context.email;

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Settings</h1>
      <Card className="flex flex-col items-start gap-3 p-5">
        {name ? <p className="text-ink">Signed in as {name}.</p> : null}
        <p className="text-ink-muted">Timezone: {context.timezone}</p>
        <form action={signOut}>
          <button type="submit" className={secondaryButton}>
            Sign out
          </button>
        </form>
      </Card>
    </main>
  );
}
