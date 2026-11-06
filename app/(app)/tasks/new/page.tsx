import type { Metadata } from "next";
import { TaskForm } from "@/components/task-form";
import { Card } from "@/components/ui";
import { safeNextPath } from "@/lib/auth/routes";
import { getAppContext } from "@/lib/data/context";
import { listContacts } from "@/lib/data/tasks";

export const metadata: Metadata = { title: "Add task · FollowThrough" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ meeting?: string; return_to?: string }> }) {
  const context = await getAppContext();
  const params = await searchParams;
  const contacts = await listContacts(context);

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Add task</h1>
      <Card className="p-5">
        <TaskForm returnTo={safeNextPath(params.return_to ?? "/my-tasks")} meetingId={params.meeting} contacts={contacts} />
      </Card>
    </main>
  );
}
