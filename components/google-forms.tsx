"use client";

import { useActionState } from "react";
import {
  chooseTaskList,
  createMeetingFromEvent,
  disconnectGoogle,
  remakeCalendar,
  retrySync,
  type GoogleState,
} from "@/app/(app)/settings/google-actions";
import { secondaryButton } from "./button-styles";
import { ConfirmButton, SubmitButton } from "./submit-button";
import { FormError, inputClass, labelClass } from "./ui";

const EMPTY: GoogleState = { error: null, saved: false };

export function DisconnectGoogle() {
  const [state, action] = useActionState(disconnectGoogle, EMPTY);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <ConfirmButton
        className={secondaryButton}
        message="Disconnect Google? Syncing stops and FollowThrough's access is removed. Meetings and tasks stay here."
      >
        Disconnect Google
      </ConfirmButton>
      <FormError message={state.error} />
    </form>
  );
}

export function RemakeCalendar() {
  const [state, action] = useActionState(remakeCalendar, EMPTY);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <p className="text-sm text-ink">The FollowThrough calendar was deleted in Google, so due dates aren&apos;t being added.</p>
      <SubmitButton pendingLabel="Making it" className={secondaryButton}>
        Make the calendar again
      </SubmitButton>
      <FormError message={state.error} />
    </form>
  );
}

export function TaskListForm({ lists, current }: { lists: { id: string; title: string }[]; current: string | null }) {
  const [state, action] = useActionState(chooseTaskList, EMPTY);
  const hasFollowThrough = lists.some((list) => list.title === "FollowThrough");
  // A saved list that was deleted in Google mustn't quietly show as a different list.
  const known = current !== null && lists.some((list) => list.id === current);
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <div className="flex w-full max-w-md flex-col gap-1.5">
        <label htmlFor="tasklist" className={labelClass}>
          Google Tasks list
        </label>
        <select id="tasklist" name="tasklist" defaultValue={known ? current! : hasFollowThrough ? "" : "new"} className={inputClass}>
          {known ? null : <option value="">Choose a list</option>}
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.title}
            </option>
          ))}
          {hasFollowThrough ? null : <option value="new">Make a new list called FollowThrough</option>}
        </select>
      </div>
      <FormError message={state.error} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton}>Save list</SubmitButton>
        <p role="status" className="text-sm text-ink-muted">
          {state.saved ? "Saved." : ""}
        </p>
      </div>
    </form>
  );
}

export function MeetingFromEvent({ eventId, title }: { eventId: string; title: string }) {
  const [state, action] = useActionState(createMeetingFromEvent, EMPTY);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="event_id" value={eventId} />
      <SubmitButton pendingLabel="Creating" className={secondaryButton}>
        <span>
          Create meeting<span className="sr-only"> from {title}</span>
        </span>
      </SubmitButton>
      <FormError message={state.error} />
    </form>
  );
}

export function RetrySync({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(retrySync, EMPTY);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="task_id" value={taskId} />
      <SubmitButton pendingLabel="Trying again" className={secondaryButton}>
        Retry
      </SubmitButton>
      <FormError message={state.error} />
    </form>
  );
}
