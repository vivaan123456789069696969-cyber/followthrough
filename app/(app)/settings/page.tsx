import type { Metadata } from "next";
import type { ReactNode } from "react";
import { secondaryButton } from "@/components/button-styles";
import { DeleteAccount } from "@/components/delete-account";
import { DestinationFields } from "@/components/destination-fields";
import { GoogleSection } from "@/components/google-section";
import { googleReady } from "@/lib/google/schedule";
import { SettingsForm } from "@/components/settings-form";
import { SourceCards } from "@/components/sources";
import { Card, inputClass, labelClass } from "@/components/ui";
import { aiConfigured, monthlyCapUsd } from "@/lib/ai/extract";
import { getAppContext } from "@/lib/data/context";
import { signOut } from "../actions";
import { saveDestination, saveName, saveRetention, saveTimezone } from "./actions";

export const metadata: Metadata = { title: "Settings · FollowThrough" };

const RETENTION_OPTIONS = [
  { value: "keep", label: "Keep notes" },
  { value: "30", label: "Delete after 30 days" },
  { value: "90", label: "Delete after 90 days" },
  { value: "180", label: "Delete after 180 days" },
  { value: "365", label: "Delete after 1 year" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-xl font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

const dollars = (amount: number) => `$${amount.toFixed(2)}`;

function timezones(current: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return all.includes(current) ? all : [current, ...all];
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const context = await getAppContext();
  const { google } = await searchParams;
  const googleAvailable = googleReady();
  const { profile, supabase, userId } = context;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data: usage } = await supabase.from("ai_usage").select("cost_usd").eq("user_id", userId).gte("created_at", monthStart.toISOString());
  const spent = (usage ?? []).reduce((total, row) => total + Number(row.cost_usd), 0);

  const retention = profile?.note_retention_days ? String(profile.note_retention_days) : "keep";
  // A value saved some other way still shows as itself, so saving doesn't quietly change it.
  const retentionOptions = RETENTION_OPTIONS.some((option) => option.value === retention)
    ? RETENTION_OPTIONS
    : [...RETENTION_OPTIONS, { value: retention, label: `Delete after ${retention} days` }];

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Settings</h1>

      <Section id="profile-heading" title="Profile">
        <Card className="flex flex-col gap-5 p-5">
          {context.email ? <p className="text-ink">Signed in as {context.email}.</p> : null}
          <SettingsForm action={saveName}>
            <div className="flex w-full max-w-md flex-col gap-1.5">
              <label htmlFor="full-name" className={labelClass}>
                Your name
              </label>
              <input id="full-name" name="full_name" maxLength={100} autoComplete="name" defaultValue={profile?.full_name ?? ""} className={inputClass} />
            </div>
          </SettingsForm>
          <SettingsForm action={saveTimezone}>
            <div className="flex w-full max-w-md flex-col gap-1.5">
              <label htmlFor="timezone" className={labelClass}>
                Timezone
              </label>
              <select id="timezone" name="timezone" defaultValue={context.timezone} aria-describedby="timezone-hint" className={inputClass}>
                {timezones(context.timezone).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <p id="timezone-hint" className="text-sm text-ink-muted">
                Used for due dates and for working out which day &ldquo;Thursday&rdquo; means in your notes.
              </p>
            </div>
          </SettingsForm>
        </Card>
      </Section>

      <Section id="sources-heading" title="Sources">
        <SourceCards googleAvailable={googleAvailable} />
      </Section>

      <Section id="google-heading" title="Google">
        <GoogleSection context={context} status={google} />
      </Section>

      <Section id="destination-heading" title="Task destination">
        <Card className="p-5">
          <SettingsForm action={saveDestination}>
            <DestinationFields current={profile?.task_destination ?? null} idPrefix="settings-destination" googleAvailable={googleAvailable} />
          </SettingsForm>
        </Card>
      </Section>

      <Section id="ai-heading" title="AI suggestions">
        <Card className="flex flex-col gap-2 p-5 text-ink">
          <p>
            When you press Suggest actions on a meeting&apos;s notes, those notes are sent to Anthropic&apos;s Claude to find commitments. Nothing is sent
            otherwise, and nothing becomes a task until you confirm it.
          </p>
          {aiConfigured() ? (
            <p>
              This month: {dollars(spent)} of your {dollars(monthlyCapUsd())} limit.
            </p>
          ) : (
            <p className="text-ink-muted">AI suggestions aren&apos;t set up on this app yet.</p>
          )}
        </Card>
      </Section>

      <Section id="notes-heading" title="Keeping notes">
        <Card className="p-5">
          <SettingsForm action={saveRetention}>
            <div className="flex w-full max-w-md flex-col gap-1.5">
              <label htmlFor="note-retention" className={labelClass}>
                Original notes
              </label>
              <select id="note-retention" name="note_retention" defaultValue={retention} aria-describedby="retention-hint" className={inputClass}>
                {retentionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p id="retention-hint" className="text-sm text-ink-muted">
                Old notes are deleted once a day, including notes you already have that are older than this. Suggestions you haven&apos;t confirmed
                go with them. Tasks you confirmed keep their quote from the notes, so you can still see where each one came from.
              </p>
            </div>
          </SettingsForm>
        </Card>
      </Section>

      <Section id="data-heading" title="Your data">
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-ink">Download everything in your account as a JSON file: meetings, notes, suggestions, tasks and settings.</p>
          {/* A plain link: the file downloads, and a failure shows as a page instead of a broken file. */}
          <a href="/settings/export" className={secondaryButton}>
            Export data
          </a>
        </Card>
      </Section>

      <Section id="account-heading" title="Account">
        <Card className="flex flex-wrap items-center gap-3 p-5">
          <form action={signOut}>
            <button type="submit" className={secondaryButton}>
              Sign out
            </button>
          </form>
          <DeleteAccount />
        </Card>
      </Section>
    </main>
  );
}
