import { addDays } from "./dates";

export type TaskFacts = {
  owner_user_id: string | null;
  owner_contact_id: string | null;
  due_date: string | null;
  snoozed_until: string | null;
  status: "open" | "done" | "dismissed";
  created_at: string;
};

export const isMine = (task: TaskFacts, userId: string) => task.owner_user_id === userId;
export const isWaitingOnOthers = (task: TaskFacts) => task.status === "open" && task.owner_contact_id !== null;
const hasNoOwner = (task: TaskFacts) => task.owner_user_id === null && task.owner_contact_id === null;
export const needsOwner = (task: TaskFacts) => task.status === "open" && hasNoOwner(task);
export const needsDate = (task: TaskFacts) => task.status === "open" && task.due_date === null;

export function isSnoozed(task: TaskFacts, today: string): boolean {
  return task.snoozed_until !== null && task.snoozed_until > today;
}

export function isOverdue(task: TaskFacts, today: string): boolean {
  return task.status === "open" && task.due_date !== null && task.due_date < today;
}

/** The three dashboard tiles. A snooze can't hide a missed deadline, so it doesn't change these. */
export function computeStats(tasks: TaskFacts[], userId: string, today: string) {
  const lastDueSoonDay = addDays(today, 7);
  const open = tasks.filter((task) => task.status === "open");
  return {
    dueSoon: open.filter(
      (task) => isMine(task, userId) && task.due_date !== null && task.due_date >= today && task.due_date <= lastDueSoonDay,
    ).length,
    overdue: open.filter((task) => isMine(task, userId) && isOverdue(task, today)).length,
    waiting: open.filter(isWaitingOnOthers).length,
  };
}

/** Most urgent first: overdue, then by due date, then tasks with no date. */
export function byUrgency<T extends TaskFacts>(a: T, b: T): number {
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** What the user can act on: their own tasks and ones nobody owns yet, minus snoozed ones. */
export function myOpenTasks<T extends TaskFacts>(tasks: T[], userId: string): T[] {
  return tasks.filter((task) => task.status === "open" && (isMine(task, userId) || hasNoOwner(task))).sort(byUrgency);
}

export function nextActions<T extends TaskFacts>(tasks: T[], userId: string, today: string, limit = 5) {
  const all = myOpenTasks(tasks, userId).filter((task) => !isSnoozed(task, today));
  return { visible: all.slice(0, limit), total: all.length };
}
