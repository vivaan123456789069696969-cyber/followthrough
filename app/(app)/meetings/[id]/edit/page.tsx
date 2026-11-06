import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MeetingForm } from "@/components/meeting-form";
import { Card } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";
import { getMeeting } from "@/lib/data/meetings";
import { utcToLocalInput } from "@/lib/tasks/dates";

export const metadata: Metadata = { title: "Edit meeting · FollowThrough" };

export default async function EditMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getAppContext();
  const { id } = await params;
  const meeting = await getMeeting(context, id);
  if (!meeting) notFound();

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Edit meeting</h1>
      <Card className="p-5">
        <MeetingForm defaultStartsAt={utcToLocalInput(meeting.starts_at, context.timezone)} meeting={meeting} />
      </Card>
    </main>
  );
}
