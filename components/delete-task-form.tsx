"use client";

import { useActionState } from "react";
import { deleteTask } from "@/app/(app)/tasks/actions";
import { secondaryButton } from "./button-styles";
import { SubmitButton } from "./submit-button";
import { FormError } from "./ui";

export function DeleteTaskForm({ id, returnTo, hasGoogle }: { id: string; returnTo: string; hasGoogle: boolean }) {
  const [state, action] = useActionState(deleteTask, { error: null });

  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="min-h-8 cursor-pointer font-medium">Delete task</summary>
      <form action={action} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="return_to" value={returnTo} />
        <p>
          This removes the task for good{hasGoogle ? ", including its copies in Google" : ""}. Marking it done keeps a record instead.
        </p>
        <div>
          <SubmitButton pendingLabel="Deleting" className={secondaryButton}>
            Delete this task
          </SubmitButton>
        </div>
        <FormError message={state.error} />
      </form>
    </details>
  );
}
