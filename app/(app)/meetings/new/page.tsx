import type { Metadata } from "next";
import { MeetingForm } from "@/components/meeting-form";
import { Card } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";
import { utcToLocalInput } from "@/lib/tasks/dates";

export const metadata: Metadata = { title: "Add meeting · FollowThrough" };

export default async function NewMeetingPage() {
  const context = await getAppContext();

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Add meeting</h1>
      <Card className="p-5">
        <MeetingForm defaultStartsAt={utcToLocalInput(new Date().toISOString(), context.timezone)} />
      </Card>
    </main>
  );
}
