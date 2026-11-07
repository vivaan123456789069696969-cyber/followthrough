"use client";

import { useActionState, useState } from "react";
import { confirmSuggestion, dismissSuggestion } from "@/app/(app)/meetings/[id]/review/actions";
import { secondaryButton } from "./button-styles";
import { SubmitButton } from "./submit-button";
import { Badge, FormError, inputClass, labelClass } from "./ui";

export type CardSuggestion = {
  id: string;
  title: string;
  owner_name: string | null;
  owner_is_me: boolean;
  due_date: string | null;
  due_label: string | null;
  due_date_basis: string | null;
  source_quote: string;
  source_label: string;
  open_questions: string[];
};

export function SuggestionCard({ suggestion }: { suggestion: CardSuggestion }) {
  const [state, action] = useActionState(confirmSuggestion, { error: null });
  const [dismissState, dismissAction] = useActionState(dismissSuggestion, { error: null });
  const [editing, setEditing] = useState(false);
  const startingOwner = suggestion.owner_is_me ? "me" : suggestion.owner_name ? "other" : "none";
  const [ownerKind, setOwnerKind] = useState(startingOwner);
  const fieldId = (name: string) => `${name}-${suggestion.id}`;

  return (
    <article
      data-suggestion
      tabIndex={-1}
      aria-labelledby={fieldId("title-heading")}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 focus-visible:outline-2"
    >
      <figure className="flex flex-col gap-1.5">
        <blockquote className="rounded-lg bg-sage-100 p-3 break-words whitespace-pre-wrap text-ink">
          &ldquo;{suggestion.source_quote}&rdquo;
        </blockquote>
        <figcaption className="text-sm text-ink-muted">
          {suggestion.source_label} ·{" "}
          <a href={`#quote-${suggestion.id}`} className="text-brand underline">
            Show in notes
          </a>
        </figcaption>
      </figure>

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="suggestion_id" value={suggestion.id} />
        <h3 id={fieldId("title-heading")} className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Task details
        </h3>

        {editing ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={fieldId("title")} className={labelClass}>
                Task
              </label>
              <input id={fieldId("title")} name="title" required maxLength={300} defaultValue={suggestion.title} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={fieldId("owner")} className={labelClass}>
                Owner
              </label>
              <select id={fieldId("owner")} name="owner_kind" value={ownerKind} onChange={(event) => setOwnerKind(event.target.value)} className={inputClass}>
                <option value="me">Me</option>
                <option value="other">Someone else</option>
                <option value="none">Not decided yet</option>
              </select>
            </div>
            {ownerKind === "other" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={fieldId("owner-name")} className={labelClass}>
                  Their name
                </label>
                <input id={fieldId("owner-name")} name="owner_name" required maxLength={200} defaultValue={suggestion.owner_name ?? ""} className={inputClass} />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <label htmlFor={fieldId("due")} className={labelClass}>
                Due date
              </label>
              <input id={fieldId("due")} name="due_date" type="date" defaultValue={suggestion.due_date ?? ""} className={inputClass} />
            </div>
          </>
        ) : (
          <>
            <input type="hidden" name="title" value={suggestion.title} />
            <input type="hidden" name="owner_kind" value={startingOwner} />
            <input type="hidden" name="owner_name" value={suggestion.owner_name ?? ""} />
            <input type="hidden" name="due_date" value={suggestion.due_date ?? ""} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-ink-muted">Task</dt>
              <dd className="font-medium break-words text-ink">{suggestion.title}</dd>
              <dt className="text-ink-muted">Owner</dt>
              <dd>{suggestion.owner_is_me ? "You" : suggestion.owner_name ? suggestion.owner_name : <Badge tone="warm">Needs owner</Badge>}</dd>
              <dt className="text-ink-muted">Due date</dt>
              <dd>
                {suggestion.due_label ? (
                  <>
                    {suggestion.due_label}
                    {suggestion.due_date_basis ? <span className="text-ink-muted"> (&ldquo;{suggestion.due_date_basis}&rdquo;)</span> : null}
                  </>
                ) : (
                  <Badge tone="warm">Needs date</Badge>
                )}
              </dd>
            </dl>
          </>
        )}

        {suggestion.open_questions.length ? (
          <ul className="list-disc pl-5 text-sm text-ink-muted">
            {suggestion.open_questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        ) : null}

        <FormError message={state.error ?? dismissState.error} />
        <div className="flex flex-wrap gap-2">
          <span data-confirm>
            <SubmitButton pendingLabel="Confirming">Confirm task</SubmitButton>
          </span>
          {editing ? null : (
            <button type="button" onClick={() => setEditing(true)} className={secondaryButton}>
              Edit details
            </button>
          )}
          <button type="submit" formAction={dismissAction} formNoValidate data-dismiss className={secondaryButton}>
            Dismiss
          </button>
        </div>
      </form>
    </article>
  );
}
