"use client";

import { useActionState } from "react";
import { saveMeeting } from "@/app/(app)/meetings/actions";
import { SubmitButton } from "./submit-button";
import { FormError, inputClass, labelClass } from "./ui";

type Props = {
  defaultStartsAt: string;
  meeting?: { id: string; title: string; attendees: string[] };
};

export function MeetingForm({ defaultStartsAt, meeting }: Props) {
  const [state, action] = useActionState(saveMeeting, { error: null });
  // After an error the server sends back what was typed, so nothing is lost.
  const values = state.values;

  return (
    <form action={action} key={JSON.stringify(values ?? {})} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={meeting?.id ?? ""} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className={labelClass}>
          Meeting title
        </label>
        <input id="title" name="title" required maxLength={300} defaultValue={values?.title ?? meeting?.title} className={inputClass} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="starts_at" className={labelClass}>
          Date and time
        </label>
        <input
          id="starts_at"
          name="starts_at"
          type="datetime-local"
          required
          defaultValue={values?.starts_at ?? defaultStartsAt}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="attendees" className={labelClass}>
          Attendees (optional)
        </label>
        <input
          id="attendees"
          name="attendees"
          aria-describedby="attendees-hint"
          defaultValue={values?.attendees ?? meeting?.attendees.join(", ")}
          className={inputClass}
        />
        <p id="attendees-hint" className="text-sm text-ink-muted">
          Separate names with commas.
        </p>
      </div>
      <FormError message={state.error} />
      <div>
        <SubmitButton>{meeting ? "Save changes" : "Add meeting"}</SubmitButton>
      </div>
    </form>
  );
}
