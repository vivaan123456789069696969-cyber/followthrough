import { Suspense } from "react";
import type { AppContext } from "@/lib/data/context";
import { listTaskLists } from "@/lib/google/api";
import { hasFeature, type GoogleFeature } from "@/lib/google/config";
import { plainError } from "@/lib/google/http";
import { loadIntegration, withToken } from "@/lib/google/integration";
import { googleReady } from "@/lib/google/schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { secondaryButton } from "./button-styles";
import { DisconnectGoogle, RemakeCalendar, TaskListForm } from "./google-forms";
import { Badge, Card } from "./ui";

const FEATURES: { feature: GoogleFeature; title: string; does: string; asks: string }[] = [
  {
    feature: "calendar",
    title: "Calendar events",
    does: "Lists your meetings from the last and next two weeks, so you can make a meeting here with its title, time and attendees filled in.",
    asks: "Google asks to let FollowThrough see events on calendars you own. It can't change them.",
  },
  {
    feature: "deadlines",
    title: "Due dates in Calendar",
    does: "Adds each open task with a due date to a separate calendar called FollowThrough, and removes it when the task is done.",
    asks: "Google asks to let FollowThrough make its own calendars and manage events on those only. Your other calendars aren't touched.",
  },
  {
    feature: "tasks",
    title: "Google Tasks",
    does: "When Google Tasks is your task destination, adds your open tasks to a list you choose, and marks them complete when you mark them done here. Changes made in Google aren't read back.",
    asks: "Google asks to let FollowThrough create and edit your tasks. Google has no narrower permission for this.",
  },
];

const MESSAGES: Record<string, string> = {
  "connected-calendar": "Calendar events are on.",
  "connected-deadlines": "Due dates in Calendar are on. A calendar called FollowThrough was added.",
  "connected-tasks": "Google Tasks is on. Choose a list below.",
  cancelled: "Nothing was changed. You cancelled on Google's page.",
  "not-granted": "That permission wasn't given on Google's page, so that part stays off.",
  expired: "That took too long or came from another tab. Try again.",
  unavailable: "Google isn't set up on this app yet.",
  error: "We couldn't connect to Google. Try again.",
};

async function TaskLists({ context }: { context: AppContext }) {
  const admin = createAdminClient();
  if (!admin) return null;
  const integration = await loadIntegration(admin, context.workspaceId, context.userId);
  if (!integration) return null;
  let lists: { id: string; title: string }[];
  try {
    lists = await withToken(admin, integration, (token) => listTaskLists(token));
  } catch (error) {
    return <p className="text-sm text-ink-muted">{plainError(error)}</p>;
  }
  return <TaskListForm lists={lists} current={integration.tasklist_id} />;
}

/** The Google part of Settings. Reads only the columns users may see; no token leaves the server. */
export async function GoogleSection({ context, status }: { context: AppContext; status?: string }) {
  if (!googleReady()) {
    return (
      <Card className="p-5">
        <p className="text-ink">Google isn&apos;t set up on this app yet. Everything else works without it.</p>
      </Card>
    );
  }

  const { data: integration } = await context.supabase
    .from("integrations")
    .select("status, scopes, calendar_id, tasklist_id")
    .eq("user_id", context.userId)
    .eq("provider", "google")
    .maybeSingle();
  const message = status ? MESSAGES[status] : undefined;

  return (
    <div className="flex flex-col gap-4">
      {message ? (
        <p role="status" className="rounded-lg bg-sage-100 p-3 text-ink">
          {message}
        </p>
      ) : null}
      {integration?.status === "needs_reconnect" ? (
        <p role="alert" className="rounded-lg bg-warm p-3 text-on-warm">
          Google needs you to connect again. This happens when access is removed in your Google account, and every 7 days while this app is in
          Google&apos;s testing mode. Syncing is paused until then.
        </p>
      ) : null}

      {FEATURES.map(({ feature, title, does, asks }) => {
        const on = integration?.status === "active" && hasFeature(integration.scopes, feature);
        return (
          <Card key={feature} className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-ink">{title}</h3>
              {on ? <Badge tone="lime">On</Badge> : <Badge tone="plain">Off</Badge>}
            </div>
            <p className="text-ink">{does}</p>
            <p className="text-sm text-ink-muted">{asks}</p>
            {feature === "tasks" && on ? (
              <Suspense
                fallback={
                  <p role="status" className="text-sm text-ink-muted">
                    Loading your lists
                  </p>
                }
              >
                <TaskLists context={context} />
              </Suspense>
            ) : null}
            {feature === "deadlines" && on && !integration?.calendar_id ? <RemakeCalendar /> : null}
            {on ? null : (
              // A plain link: Google's page opens, then comes back here.
              <a href={`/api/google/connect?feature=${feature}`} className={`${secondaryButton} self-start`}>
                {integration?.status === "needs_reconnect" && hasFeature(integration.scopes, feature) ? `Reconnect ${title}` : `Turn on ${title}`}
              </a>
            )}
          </Card>
        );
      })}

      {integration ? (
        <Card className="flex flex-col gap-3 p-5">
          <p className="text-ink">
            Disconnecting removes FollowThrough&apos;s access in your Google account. Meetings and tasks stay here, and what was already sent to Google
            stays there.
          </p>
          <DisconnectGoogle />
        </Card>
      ) : null}
    </div>
  );
}
