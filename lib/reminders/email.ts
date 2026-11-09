import { longDate } from "@/lib/tasks/dates";
import type { Kind, ReminderTask } from "./plan";

// The reminder email: plain HTML with a text version, no images or tracking, readable in
// light and dark mode. Every value from the database is escaped.

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const SECTIONS: { kind: Kind; heading: string }[] = [
  { kind: "overdue", heading: "Overdue" },
  { kind: "due_today", heading: "Due today" },
  { kind: "due_tomorrow", heading: "Due tomorrow" },
  { kind: "waiting_weekly", heading: "Waiting on others" },
];

export type DigestEmail = { subject: string; html: string; text: string };

export function subjectFor(items: { kind: Kind; task: ReminderTask }[]): string {
  if (items.length === 1) {
    const [{ kind, task }] = items as [{ kind: Kind; task: ReminderTask }];
    const label = SECTIONS.find((section) => section.kind === kind)!.heading;
    // A subject is one line: line breaks and control characters from a title become spaces.
    return `${label}: ${task.title}`.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 150);
  }
  const own = items.filter((item) => item.kind !== "waiting_weekly");
  if (!own.length) return `${items.length} things you're waiting on`;
  if (own.length === 1 && items.length > 1) {
    // One of the person's own plus the weekly list: lead with theirs.
    const label = SECTIONS.find((section) => section.kind === own[0]!.kind)!.heading;
    return `${label}: ${own[0]!.task.title}, and what you're waiting on`.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 150);
  }
  // Nothing due today or late: it's a heads-up, not a call to act today.
  if (own.every((item) => item.kind === "due_tomorrow")) return `${own.length} things due tomorrow`;
  return `${own.length} things need you today`;
}

export function renderDigest(input: {
  items: { kind: Kind; task: ReminderTask }[];
  /** Tasks left out because the email is full. They're all in the app. */
  more?: number;
  appUrl: string;
  unsubscribeUrl: string;
  firstName: string | null;
}): DigestEmail {
  const { items, appUrl, unsubscribeUrl, firstName } = input;
  const more = input.more ?? 0;
  const moreLine = more ? `And ${more} more in FollowThrough.` : "";
  const subject = subjectFor(items);
  const settingsUrl = `${appUrl}/settings#reminders-heading`;
  const taskUrl = (task: ReminderTask) => `${appUrl}/my-day?task=${task.id}`;
  const context = (task: ReminderTask) =>
    [task.meeting_title ? `From ${task.meeting_title}` : null, task.owner_name ? `Owner: ${task.owner_name}` : null, task.due_date ? longDate(task.due_date) : null]
      .filter(Boolean)
      .join(" · ");

  const htmlSections = SECTIONS.map(({ kind, heading }) => {
    const list = items.filter((item) => item.kind === kind);
    if (!list.length) return "";
    const rows = list
      .map(
        ({ task }) => `
        <tr><td class="item">
          <p class="title">${escape(task.title)}</p>
          ${context(task) ? `<p class="context">${escape(context(task))}</p>` : ""}
          <p><a class="button" href="${escape(taskUrl(task))}" aria-label="${escape(`Open task: ${task.title}`)}">Open task</a></p>
        </td></tr>`,
      )
      .join("");
    return `<h2>${heading}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(subject)}</title>
<style>
  body { margin: 0; background: #EEF0EC; color: #172B2A; font-family: Inter, Arial, sans-serif; font-size: 16px; line-height: 1.5; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
  .card { background: #FFFFFF; border: 1px solid #D9E0DA; border-radius: 16px; padding: 24px; }
  .brand { color: #176B58; font-weight: 600; margin: 0 0 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 16px; margin: 24px 0 8px; color: #4A5956; }
  .item { border-top: 1px solid #D9E0DA; padding: 12px 0; }
  .title { font-weight: 600; margin: 0; }
  .context { color: #4A5956; font-size: 14px; margin: 2px 0 0; }
  .button { display: inline-block; margin-top: 8px; background: #176B58; color: #FFFFFF !important; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 500; }
  .footer { color: #4A5956; font-size: 13px; margin-top: 24px; }
  .footer a { color: #176B58; }
  @media (prefers-color-scheme: dark) {
    body { background: #102321; color: #EEF0EC; }
    .card { background: #1A3933; border-color: #285348; }
    h2, .context, .footer { color: #C9D6D1; }
    .item { border-color: #285348; }
    .brand, .footer a { color: #D6F278; }
    .button { background: #D6F278; color: #102321 !important; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <p class="brand">followthrough</p>
      <h1>${escape(firstName ? `${firstName}, here's what needs you` : "Here's what needs you")}</h1>
      ${htmlSections}
      ${moreLine ? `<p><a href="${escape(`${appUrl}/my-day`)}">${moreLine}</a></p>` : ""}
      <p class="footer">
        <a href="${escape(settingsUrl)}">Change reminder settings</a> ·
        <a href="${escape(unsubscribeUrl)}">Turn off reminders</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const textSections = SECTIONS.map(({ kind, heading }) => {
    const list = items.filter((item) => item.kind === kind);
    if (!list.length) return "";
    return `${heading}\n${list.map(({ task }) => `- ${task.title}${context(task) ? ` (${context(task)})` : ""}\n  Open task: ${taskUrl(task)}`).join("\n")}\n`;
  })
    .filter(Boolean)
    .join("\n");

  const text = `${firstName ? `${firstName}, here's what needs you` : "Here's what needs you"}\n\n${textSections}${moreLine ? `\n${moreLine} ${appUrl}/my-day\n` : ""}\nChange reminder settings: ${settingsUrl}\nTurn off reminders: ${unsubscribeUrl}\n`;

  return { subject, html, text };
}
