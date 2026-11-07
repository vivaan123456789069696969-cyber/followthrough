"use client";

import { useActionState } from "react";
import { suggestActions } from "@/app/(app)/meetings/[id]/review/actions";
import { SubmitButton } from "./submit-button";
import { FormError } from "./ui";

/** Sends notes to Claude only when the user presses the button, and says so first. */
export function SuggestForm({ noteId, pendingCount = 0 }: { noteId: string; pendingCount?: number }) {
  const [state, action] = useActionState(suggestActions, { error: null });

  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="note_id" value={noteId} />
      <p className="text-sm text-ink-muted">
        This sends these notes to Anthropic&apos;s Claude to find commitments. Nothing becomes a task until you confirm it.
        {pendingCount
          ? ` Asking again replaces the ${pendingCount === 1 ? "suggestion" : `${pendingCount} suggestions`} waiting for review. Confirmed and dismissed ones stay as they are.`
          : ""}
      </p>
      <SubmitButton pendingLabel="Finding actions, this can take a minute">{pendingCount ? "Suggest again" : "Suggest actions"}</SubmitButton>
      <FormError message={state.error} />
    </form>
  );
}
