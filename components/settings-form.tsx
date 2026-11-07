"use client";

import { useActionState, useState, type ReactNode } from "react";
import type { SettingsState } from "@/app/(app)/settings/actions";
import { secondaryButton } from "./button-styles";
import { SubmitButton } from "./submit-button";
import { FormError } from "./ui";

type Action = (previous: SettingsState, formData: FormData) => Promise<SettingsState>;

/**
 * One settings section with its own Save button. "Saved." shows after each save and
 * clears as soon as anything is changed again, so it never describes unsaved edits.
 */
export function SettingsForm({ action, children, submitLabel = "Save" }: { action: Action; children: ReactNode; submitLabel?: string }) {
  const [state, formAction] = useActionState(action, { error: null, saved: false });
  // The result that was on screen when the user last changed something. Each save
  // returns a new object, so a later save shows "Saved." again.
  const [editedAfter, setEditedAfter] = useState<SettingsState | null>(null);
  const showSaved = state.saved && editedAfter !== state;

  return (
    <form action={formAction} onInput={() => setEditedAfter(state)} className="flex flex-col items-start gap-3">
      {children}
      <FormError message={state.error} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton}>{submitLabel}</SubmitButton>
        <p role="status" className="text-sm text-ink-muted">
          {showSaved ? "Saved." : ""}
        </p>
      </div>
    </form>
  );
}
