import { Badge } from "./ui";

type Destination = "app" | "google_tasks" | null;

const OPTIONS = [
  { value: "app", label: "In this app", hint: "Tasks stay in FollowThrough. Everything works with no connections." },
  {
    value: "google_tasks",
    label: "Google Tasks",
    hint: "Confirmed tasks are also added to Google Tasks. This needs a Google connection, which arrives in a later update. Until then tasks stay here.",
  },
  { value: "later", label: "Choose later", hint: "Tasks stay here until you decide." },
] as const;

/** "Where confirmed tasks go", used in setup and in Settings. */
export function DestinationFields({ current, idPrefix }: { current: Destination; idPrefix: string }) {
  const selected = current ?? "later";
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-medium text-ink">Where confirmed tasks go</legend>
      {OPTIONS.map((option) => {
        const id = `${idPrefix}-${option.value}`;
        return (
          <div key={option.value} className="flex items-start gap-3 rounded-lg border border-line p-3">
            <input
              id={id}
              type="radio"
              name="task_destination"
              value={option.value}
              defaultChecked={option.value === selected}
              aria-describedby={`${id}-hint`}
              className="mt-1 size-5 accent-brand"
            />
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={id} className="font-medium text-ink">
                  {option.label}
                </label>
                {option.value === "google_tasks" ? <Badge tone="lilac">Coming later</Badge> : null}
              </div>
              <p id={`${id}-hint`} className="text-sm text-ink-muted">
                {option.hint}
              </p>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
