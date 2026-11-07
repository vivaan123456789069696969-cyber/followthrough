"use client";

import { useActionState, useRef, useState } from "react";
import { deleteAccount } from "@/app/(app)/settings/actions";
import { secondaryButton } from "./button-styles";
import { SubmitButton } from "./submit-button";
import { FormError, inputClass, labelClass } from "./ui";

const dangerButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-on-warm px-4 text-base font-medium text-warm transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

/** Says exactly what goes, and asks for the word "delete" before doing it. */
export function DeleteAccount() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(deleteAccount, { error: null, saved: false });
  // A new key each time it opens, so an old error or typed word doesn't linger.
  const [attempt, setAttempt] = useState(0);
  // The result on screen when the dialog last opened. Only a newer result shows its error.
  const [openedWith, setOpenedWith] = useState<typeof state | null>(null);
  const error = state !== openedWith ? state.error : null;

  return (
    <>
      <button
        type="button"
        className={secondaryButton}
        onClick={() => {
          setAttempt((value) => value + 1);
          setOpenedWith(state);
          dialog.current?.showModal();
        }}
      >
        Delete account
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="delete-heading"
        // While deleting, Escape doesn't close it, so the result is never hidden.
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-6 text-ink backdrop:bg-brand-deep/50"
      >
        <h2 id="delete-heading" className="text-xl font-semibold">
          Delete your account?
        </h2>
        <p className="mt-2 text-ink">This deletes, for good:</p>
        <ul className="mt-1 list-disc pl-5 text-ink">
          <li>your meetings, notes and suggestions</li>
          <li>your tasks and their history</li>
          <li>your settings and sign-in</li>
        </ul>
        <p className="mt-2 text-ink-muted">It can&apos;t be undone. If you want a copy, export your data first.</p>
        <form key={attempt} action={action} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="delete-confirm" className={labelClass}>
              Type delete to confirm
            </label>
            <input
              id="delete-confirm"
              name="confirm"
              autoComplete="off"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "delete-error" : undefined}
              className={inputClass}
            />
          </div>
          <FormError id="delete-error" message={error} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Deleting" className={dangerButton}>
              Delete my account
            </SubmitButton>
            <button type="button" disabled={pending} className={secondaryButton} onClick={() => dialog.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
