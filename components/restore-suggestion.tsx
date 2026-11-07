"use client";

import { useActionState } from "react";
import { restoreSuggestion } from "@/app/(app)/meetings/[id]/review/actions";
import { secondaryButton } from "./button-styles";
import { SubmitButton } from "./submit-button";
import { FormError } from "./ui";

export function RestoreSuggestion({ id }: { id: string }) {
  const [state, action] = useActionState(restoreSuggestion, { error: null });
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="suggestion_id" value={id} />
      <SubmitButton pendingLabel="Restoring" className={secondaryButton}>
        Restore
      </SubmitButton>
      <FormError message={state.error} />
    </form>
  );
}
