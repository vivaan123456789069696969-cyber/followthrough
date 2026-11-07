import type { Metadata } from "next";
import { saveDetectedTimezone, signOut } from "@/app/(app)/actions";
import { SetupForm } from "@/components/setup-form";
import { TimezoneSync } from "@/components/timezone-sync";
import { SourceCards } from "@/components/sources";
import { Card } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";

export const metadata: Metadata = { title: "Choose your sources · FollowThrough" };

const PRINCIPLES = [
  { title: "Optional by default", body: "Skip anything. The app works with no connections." },
  { title: "Clear permissions", body: "Before anything connects, you see what it can access and why." },
  { title: "Personal dashboard", body: "Only you see your tasks and notes." },
];

const AI_NOTICE =
  "AI suggestions are optional too. Notes are sent to Anthropic's Claude only when you press Suggest actions on them, and nothing becomes a task until you confirm it.";

export default async function SetupPage() {
  const { profile } = await getAppContext();
  const firstName = profile?.full_name?.trim().split(/\s+/)[0];

  return (
    <main className="flex flex-col gap-6">
      {/* New accounts land here first, so the timezone is picked up here too. */}
      {profile && !profile.timezone ? <TimezoneSync save={saveDetectedTimezone} /> : null}
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{firstName ? `Welcome, ${firstName}` : "Welcome"}</h1>
        <p className="text-lg text-ink-muted">Choose your sources. Everything here is optional, and you can change it later in Settings.</p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-3">
        {PRINCIPLES.map((principle) => (
          <li key={principle.title} className="rounded-xl bg-sage-100 p-4">
            <p className="font-semibold text-ink">{principle.title}</p>
            <p className="text-sm text-ink-muted">{principle.body}</p>
          </li>
        ))}
      </ul>

      <section aria-labelledby="sources-heading" className="flex flex-col gap-3">
        <h2 id="sources-heading" className="text-xl font-semibold text-ink">
          Where notes come from
        </h2>
        <SourceCards />
        <p className="text-ink">{AI_NOTICE}</p>
      </section>

      <section aria-labelledby="destination-heading" className="flex flex-col gap-3">
        <h2 id="destination-heading" className="text-xl font-semibold text-ink">
          Keep work here or sync elsewhere
        </h2>
        <Card className="p-5">
          <SetupForm current={profile?.task_destination ?? null} />
        </Card>
      </section>

      <form action={signOut}>
        <button type="submit" className="min-h-11 text-ink-muted underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
