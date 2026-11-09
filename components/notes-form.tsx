"use client";

import { useActionState, useState } from "react";
import { addNotes } from "@/app/(app)/meetings/actions";
import { NOTE_SOURCES } from "@/lib/notes/source-list";
import { SubmitButton } from "./submit-button";
import { Badge, FormError, inputClass, labelClass } from "./ui";

export function NotesForm({ meetingId }: { meetingId: string }) {
  const [state, action] = useActionState(addNotes, { error: null, text: "" });
  const [source, setSource] = useState("notes");
  const choices = NOTE_SOURCES.filter((item) => item.status === "available");
  const waiting = NOTE_SOURCES.filter((item) => item.status === "needs_validation");
  const wispr = source === "wispr_import";

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="meeting_id" value={meetingId} />

      <fieldset className="flex flex-col gap-2" aria-describedby="source-description">
        <legend className="mb-1 font-medium text-ink">Where are these notes from?</legend>
        <div className="flex flex-wrap gap-2">
          {choices.map((item) => (
            <label
              key={item.id}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 has-[:checked]:border-brand has-[:checked]:bg-sage-100 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand"
            >
              <input
                type="radio"
                name="source"
                value={item.id}
                // Not "checked": a form reset after an error would clear a controlled radio.
                // defaultChecked follows the current choice, so a reset puts it back.
                defaultChecked={source === item.id}
                onChange={() => setSource(item.id)}
                className="size-5 accent-brand"
              />
              <span className="text-ink">{item.label}</span>
            </label>
          ))}
        </div>
        {/* Announced when the choice changes, so screen reader users hear what it means. */}
        <p id="source-description" aria-live="polite" className="text-sm text-ink-muted">
          {choices.find((item) => item.id === source)?.description}
        </p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="text" className={labelClass}>
          {wispr ? "Paste notes from Wispr Flow" : "Paste notes"}
        </label>
        <textarea id="text" name="text" rows={6} defaultValue={state.text} key={state.text} className={`${inputClass} py-2`} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="file" className={labelClass}>
          Or upload a file
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".txt,.md,.vtt,.srt,.docx"
          aria-describedby="file-hint"
          className="min-h-11 text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-line file:bg-sage-100 file:px-3 file:text-ink"
        />
        <p id="file-hint" className="text-sm text-ink-muted">
          .txt, .md, .vtt, .srt or .docx, up to 4 MB. A file replaces anything pasted above.
        </p>
      </div>

      {wispr
        ? waiting.map((item) => (
            // Shown as information only: there is nothing to connect yet.
            <div key={item.id} role="note" aria-labelledby={`source-${item.id}`} className="flex flex-col gap-1 rounded-lg border border-dashed border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p id={`source-${item.id}`} className="font-medium text-ink">
                  {item.label}
                </p>
                <Badge tone="lilac">Coming after validation</Badge>
              </div>
              <p className="text-sm text-ink-muted">{item.description}</p>
            </div>
          ))
        : null}

      <FormError message={state.error} />
      <div>
        <SubmitButton>{wispr ? "Import notes" : "Add notes"}</SubmitButton>
      </div>
    </form>
  );
}
