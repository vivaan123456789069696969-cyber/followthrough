"use client";

import { useActionState } from "react";
import { addNotes } from "@/app/(app)/meetings/actions";
import { SubmitButton } from "./submit-button";
import { FormError, inputClass, labelClass } from "./ui";

export function NotesForm({ meetingId }: { meetingId: string }) {
  const [state, action] = useActionState(addNotes, { error: null, text: "" });

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="meeting_id" value={meetingId} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="text" className={labelClass}>
          Paste notes
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
      <FormError message={state.error} />
      <div>
        <SubmitButton>Add notes</SubmitButton>
      </div>
    </form>
  );
}
