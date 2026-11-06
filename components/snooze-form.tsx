"use client";

import { useActionState } from "react";
import { snoozeTask } from "@/app/(app)/tasks/actions";
import { secondaryButton } from "./button-styles";
import { SubmitButton } from "./submit-button";
import { FormError, inputClass, labelClass } from "./ui";

export function SnoozeForm({ id, returnTo, minDate, snoozedUntil }: { id: string; returnTo: string; minDate: string; snoozedUntil: string | null }) {
  const [state, action] = useActionState(snoozeTask, { error: null });

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label htmlFor="snoozed_until" className={labelClass}>
        Snooze until
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="snoozed_until"
          name="snoozed_until"
          type="date"
          min={minDate}
          defaultValue={snoozedUntil ?? ""}
          className={`${inputClass} w-auto flex-1`}
        />
        <SubmitButton className={secondaryButton}>Snooze</SubmitButton>
      </div>
      <p className="text-sm text-ink-muted">Leave the date empty to end a snooze. The due date stays the same.</p>
      <FormError message={state.error} />
    </form>
  );
}
