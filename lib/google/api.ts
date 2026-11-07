import "server-only";
import { googleUrls } from "./config";
import { ContainerGone, googleFetch, googleJson, GoogleError } from "./http";

// Thin wrappers over the Calendar and Tasks REST APIs, only the calls the app needs.

type Fetch = typeof fetch;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const json = (token: string) => ({ ...auth(token), "content-type": "application/json" });
const enc = encodeURIComponent;

// ---------------------------------------------------------------- Calendar (read)

export type CalendarEvent = {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean }[];
  htmlLink?: string;
};

/** `more` is true when there were more events than were read, so the page can say so. */
export async function listEvents(
  token: string,
  window: { timeMin: string; timeMax: string },
  fetchImpl?: Fetch,
): Promise<{ events: CalendarEvent[]; more: boolean }> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  // Two pages of 100 is plenty for a four-week window; stops a huge calendar running on.
  for (let page = 0; page < 2; page++) {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: window.timeMin,
      timeMax: window.timeMax,
      maxResults: "100",
      // Meetings only: not focus time, out of office or working location.
      eventTypes: "default",
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await googleFetch(`${googleUrls().api}/calendar/v3/calendars/primary/events?${params}`, { headers: auth(token), fetchImpl });
    const body = await googleJson<{ items?: CalendarEvent[]; nextPageToken?: string }>(response);
    events.push(...(body.items ?? []).filter((event) => event.status !== "cancelled"));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return { events, more: Boolean(pageToken) };
}

export async function getEvent(token: string, id: string, fetchImpl?: Fetch): Promise<CalendarEvent> {
  const response = await googleFetch(`${googleUrls().api}/calendar/v3/calendars/primary/events/${enc(id)}`, { headers: auth(token), fetchImpl });
  return googleJson<CalendarEvent>(response);
}

// ---------------------------------------------------------------- Calendar (due dates)

export async function createCalendar(token: string, timeZone: string, fetchImpl?: Fetch): Promise<string> {
  const response = await googleFetch(`${googleUrls().api}/calendar/v3/calendars`, {
    method: "POST",
    headers: json(token),
    body: JSON.stringify({ summary: "FollowThrough", description: "Due dates for tasks confirmed in FollowThrough.", timeZone }),
    fetchImpl,
  });
  return (await googleJson<{ id: string }>(response)).id;
}

export type DeadlineEvent = { taskId: string; title: string; dueDate: string; description: string };

function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/**
 * Each task's event has a fixed id made from the task's id (Google allows 0-9 and a-v), so
 * however many times creating is tried, there's only ever one event per task.
 */
export function deadlineEventId(taskId: string): string {
  return `ft${taskId.replace(/-/g, "").toLowerCase()}`;
}

/** All-day, so the date is the same wherever the calendar is opened. */
function eventBody(deadline: DeadlineEvent) {
  return {
    summary: `Due: ${deadline.title}`.slice(0, 1024),
    description: deadline.description,
    start: { date: deadline.dueDate },
    end: { date: nextDay(deadline.dueDate) },
    transparency: "transparent",
    // Brings back an event removed earlier, when the task is reopened.
    status: "confirmed",
    extendedProperties: { private: { followthrough_task_id: deadline.taskId } },
  };
}

const gone = (error: unknown) => error instanceof GoogleError && (error.status === 404 || error.status === 410);

export async function upsertDeadline(
  token: string,
  calendarId: string,
  existingId: string | null,
  deadline: DeadlineEvent,
  fetchImpl?: Fetch,
): Promise<string> {
  const id = existingId ?? deadlineEventId(deadline.taskId);
  const base = `${googleUrls().api}/calendar/v3/calendars/${enc(calendarId)}/events`;
  const patch = async () => {
    const response = await googleFetch(`${base}/${enc(id)}`, { method: "PATCH", headers: json(token), body: JSON.stringify(eventBody(deadline)), fetchImpl });
    return (await googleJson<{ id: string }>(response)).id;
  };
  try {
    return await patch();
  } catch (error) {
    if (!gone(error)) throw error;
  }
  // Not there yet. Created once, with no automatic retry, so a slow reply can't make two.
  const response = await googleFetch(base, {
    method: "POST",
    headers: json(token),
    body: JSON.stringify({ ...eventBody(deadline), id }),
    retries: 0,
    fetchImpl,
  });
  try {
    return (await googleJson<{ id: string }>(response)).id;
  } catch (error) {
    // Already exists (made by a try whose reply was lost): update it instead.
    if (error instanceof GoogleError && error.status === 409) return patch();
    if (gone(error)) throw new ContainerGone("calendar");
    throw error;
  }
}

export async function deleteEvent(token: string, calendarId: string, id: string, fetchImpl?: Fetch): Promise<void> {
  const response = await googleFetch(`${googleUrls().api}/calendar/v3/calendars/${enc(calendarId)}/events/${enc(id)}`, {
    method: "DELETE",
    headers: auth(token),
    fetchImpl,
  });
  if (response.status === 404 || response.status === 410) return;
  await googleJson(response);
}

// ---------------------------------------------------------------- Tasks

export type TaskList = { id: string; title: string };

export async function listTaskLists(token: string, fetchImpl?: Fetch): Promise<TaskList[]> {
  const response = await googleFetch(`${googleUrls().api}/tasks/v1/users/@me/lists?maxResults=100`, { headers: auth(token), fetchImpl });
  return ((await googleJson<{ items?: TaskList[] }>(response)).items ?? []).map(({ id, title }) => ({ id, title }));
}

export async function createTaskList(token: string, title: string, fetchImpl?: Fetch): Promise<TaskList> {
  const response = await googleFetch(`${googleUrls().api}/tasks/v1/users/@me/lists`, {
    method: "POST",
    headers: json(token),
    body: JSON.stringify({ title }),
    fetchImpl,
  });
  const list = await googleJson<TaskList>(response);
  return { id: list.id, title: list.title };
}

export type PushedTask = { title: string; notes: string; dueDate: string | null; done: boolean; marker: string };

function taskBody(task: PushedTask) {
  return {
    title: task.title.slice(0, 1024),
    notes: task.notes,
    // Google Tasks keeps only the date part of `due`.
    due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null,
    status: task.done ? "completed" : "needsAction",
    ...(task.done ? {} : { completed: null }),
  };
}

/** A task made on an earlier try that failed before its id was saved, found by the link in its notes. */
async function findPushed(token: string, listId: string, marker: string, fetchImpl?: Fetch): Promise<string | null> {
  let pageToken: string | undefined;
  // Up to 1,000 tasks; a list longer than that is searched no further.
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ showCompleted: "true", showHidden: "true", maxResults: "100", ...(pageToken ? { pageToken } : {}) });
    const response = await googleFetch(`${googleUrls().api}/tasks/v1/lists/${enc(listId)}/tasks?${params}`, { headers: auth(token), fetchImpl });
    let body: { items?: { id: string; notes?: string }[]; nextPageToken?: string };
    try {
      body = await googleJson(response);
    } catch (error) {
      if (gone(error)) throw new ContainerGone("tasklist");
      throw error;
    }
    const found = body.items?.find((item) => item.notes?.includes(marker));
    if (found) return found.id;
    pageToken = body.nextPageToken;
    if (!pageToken) return null;
  }
  return null;
}

/** Removes a task from a list it no longer belongs in. Already gone counts as done. */
export async function deleteTask(token: string, listId: string, id: string, fetchImpl?: Fetch): Promise<void> {
  const response = await googleFetch(`${googleUrls().api}/tasks/v1/lists/${enc(listId)}/tasks/${enc(id)}`, {
    method: "DELETE",
    headers: auth(token),
    fetchImpl,
  });
  if (response.status === 404 || response.status === 410) return;
  await googleJson(response);
}

export async function upsertTask(
  token: string,
  listId: string,
  existingId: string | null,
  task: PushedTask,
  options: { lookForEarlier: boolean },
  fetchImpl?: Fetch,
): Promise<string> {
  const id = existingId ?? (options.lookForEarlier ? await findPushed(token, listId, task.marker, fetchImpl) : null);
  if (id) {
    const response = await googleFetch(`${googleUrls().api}/tasks/v1/lists/${enc(listId)}/tasks/${enc(id)}`, {
      method: "PATCH",
      headers: json(token),
      body: JSON.stringify(taskBody(task)),
      fetchImpl,
    });
    try {
      return (await googleJson<{ id: string }>(response)).id;
    } catch (error) {
      if (!gone(error)) throw error;
    }
  }
  // Created once, with no automatic retry: Google Tasks has no way to make it idempotent.
  const response = await googleFetch(`${googleUrls().api}/tasks/v1/lists/${enc(listId)}/tasks`, {
    method: "POST",
    headers: json(token),
    body: JSON.stringify(taskBody(task)),
    retries: 0,
    fetchImpl,
  });
  try {
    return (await googleJson<{ id: string }>(response)).id;
  } catch (error) {
    if (gone(error)) throw new ContainerGone("tasklist");
    throw error;
  }
}
