"use client";

import { useActionState, useState } from "react";
import { saveTask } from "@/app/(app)/tasks/actions";
import { SubmitButton } from "./submit-button";
import { FormError, inputClass, labelClass } from "./ui";

type Props = {
  returnTo: string;
  meetingId?: string | null;
  contacts: { id: string; display_name: string }[];
  task?: {
    id: string;
    title: string;
    description: string | null;
    owner_user_id: string | null;
    owner_contact_id: string | null;
    owner_name: string | null;
    due_date: string | null;
  };
};

export function TaskForm({ returnTo, meetingId, contacts, task }: Props) {
  const [state, action] = useActionState(saveTask, { error: null });
  const startingOwner = !task ? "me" : task.owner_user_id ? "me" : task.owner_contact_id ? "other" : "none";
  const [ownerKind, setOwnerKind] = useState(startingOwner);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={task?.id ?? ""} />
      <input type="hidden" name="meeting_id" value={meetingId ?? ""} />
      <input type="hidden" name="return_to" value={returnTo} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className={labelClass}>
          Task
        </label>
        <input id="title" name="title" required maxLength={300} defaultValue={task?.title} className={inputClass} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="owner_kind" className={labelClass}>
          Owner
        </label>
        <select
          id="owner_kind"
          name="owner_kind"
          value={ownerKind}
          onChange={(event) => setOwnerKind(event.target.value)}
          className={inputClass}
        >
          <option value="me">Me</option>
          <option value="other">Someone else</option>
          <option value="none">Not decided yet</option>
        </select>
      </div>

      {ownerKind === "other" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="owner_name" className={labelClass}>
            Their name
          </label>
          <input
            id="owner_name"
            name="owner_name"
            required
            maxLength={200}
            list="contact-names"
            defaultValue={task?.owner_name ?? ""}
            className={inputClass}
          />
          <datalist id="contact-names">
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.display_name} />
            ))}
          </datalist>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="due_date" className={labelClass}>
          Due date
        </label>
        <input id="due_date" name="due_date" type="date" defaultValue={task?.due_date ?? ""} className={inputClass} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className={labelClass}>
          Details (optional)
        </label>
        <textarea id="description" name="description" rows={3} maxLength={10000} defaultValue={task?.description ?? ""} className={`${inputClass} py-2`} />
      </div>

      <FormError message={state.error} />
      <div>
        <SubmitButton>{task ? "Save changes" : "Add task"}</SubmitButton>
      </div>
    </form>
  );
}
