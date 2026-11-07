"use client";

import { useActionState, useEffect, useRef } from "react";
import { confirmAllComplete } from "@/app/(app)/meetings/[id]/review/actions";
import { primaryButton, secondaryButton } from "./button-styles";
import { SubmitButton } from "./submit-button";
import { FormError } from "./ui";

type Item = { id: string; title: string; owner: string; due: string };

/**
 * Confirms the suggestions that already have an owner, a date and no open questions,
 * after showing exactly which ones. Only the listed ones are confirmed.
 */
export function BulkConfirm({ noteId, items }: { noteId: string; items: Item[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(confirmAllComplete, { error: null });
  const submitted = useRef(false);

  useEffect(() => {
    if (pending) {
      submitted.current = true;
      return;
    }
    // Closes after a run with no problems. With problems it stays open and says so.
    if (submitted.current && !state.error) dialog.current?.close();
    submitted.current = false;
  }, [pending, state]);

  if (!items.length) return null;

  return (
    <>
      <button type="button" className={secondaryButton} onClick={() => dialog.current?.showModal()}>
        Confirm all complete ({items.length})
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="bulk-heading"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-6 text-ink backdrop:bg-brand-deep/50"
      >
        <h2 id="bulk-heading" className="text-xl font-semibold">
          Confirm {items.length} {items.length === 1 ? "task" : "tasks"}?
        </h2>
        <p className="mt-1 text-ink-muted">These suggestions have an owner, a due date and no open questions.</p>
        <ul className="mt-4 flex max-h-72 flex-col gap-2 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg bg-sage-100 p-3">
              <span className="block font-medium break-words">{item.title}</span>
              <span className="text-sm text-ink-muted">
                {item.owner} · {item.due}
              </span>
            </li>
          ))}
        </ul>
        <form action={action} className="mt-5 flex flex-col gap-3">
          <input type="hidden" name="note_id" value={noteId} />
          {items.map((item) => (
            <input key={item.id} type="hidden" name="suggestion_id" value={item.id} />
          ))}
          <FormError message={state.error} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Confirming" className={primaryButton}>
              Confirm {items.length}
            </SubmitButton>
            <button type="button" className={secondaryButton} onClick={() => dialog.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
