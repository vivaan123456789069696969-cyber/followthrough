import type { ReminderPrefs } from "@/lib/reminders/plan";
import { inputClass, labelClass } from "./ui";

function Toggle({ name, label, hint, checked }: { name: string; label: string; hint?: string; checked: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <input id={`reminder-${name}`} type="checkbox" name={name} defaultChecked={checked} aria-describedby={hint ? `reminder-${name}-hint` : undefined} className="mt-1 size-5 accent-brand" />
      <div className="flex flex-col">
        <label htmlFor={`reminder-${name}`} className="font-medium text-ink">
          {label}
        </label>
        {hint ? (
          <p id={`reminder-${name}-hint`} className="text-sm text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The fields of the Reminders section. All times are in the person's own timezone. */
export function ReminderFields({ prefs, timezone }: { prefs: ReminderPrefs; timezone: string }) {
  return (
    <div className="flex w-full flex-col gap-4">
      <Toggle name="enabled" label="Email me reminders" hint="One email a day at most, with everything that needs you. Off until you turn it on." checked={prefs.enabled} />

      <div className="flex max-w-xs flex-col gap-1.5">
        <label htmlFor="reminder-digest-time" className={labelClass}>
          Email at
        </label>
        <input id="reminder-digest-time" name="digest_time" type="time" required defaultValue={prefs.digestTime} aria-describedby="reminder-zone" className={inputClass} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-medium text-ink">Include</legend>
        <Toggle name="due_today" label="Due today" checked={prefs.dueToday} />
        <Toggle name="overdue" label="Overdue" hint="For up to 7 days after the due date." checked={prefs.overdue} />
        <Toggle name="day_before" label="Due tomorrow" hint="A day's notice, in the same email." checked={prefs.dayBefore} />
        <Toggle name="waiting_weekly" label="Waiting on others, weekly" hint="On Mondays, tasks other people own. Sent only to you." checked={prefs.waitingWeekly} />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-ink">Quiet hours</legend>
        <p id="reminder-quiet-hint" className="text-sm text-ink-muted">
          No emails between these times. One that falls inside waits until they end. Leave both empty for none.
        </p>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reminder-quiet-start" className={labelClass}>
              From
            </label>
            <input id="reminder-quiet-start" name="quiet_start" type="time" defaultValue={prefs.quietStart ?? ""} aria-describedby="reminder-quiet-hint reminder-zone" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reminder-quiet-end" className={labelClass}>
              Until
            </label>
            <input id="reminder-quiet-end" name="quiet_end" type="time" defaultValue={prefs.quietEnd ?? ""} aria-describedby="reminder-quiet-hint reminder-zone" className={inputClass} />
          </div>
        </div>
      </fieldset>

      <p id="reminder-zone" className="text-sm text-ink-muted">
        Times are in your timezone, {timezone.replace(/_/g, " ")}.
      </p>
    </div>
  );
}
