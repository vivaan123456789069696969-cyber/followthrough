import type { Metadata } from "next";
import { getProfile, requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "My day · FollowThrough" };

export default async function MyDayPage() {
  const session = await requireSession();
  const profile = await getProfile(session);
  const { data: workspace } = await session.supabase.from("workspaces").select("name").limit(1).maybeSingle();

  return (
    <main className="flex flex-col gap-3 py-8">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">My day</h1>
      <p className="text-ink-muted">Signed in as {profile.full_name ?? session.email}.</p>
      {workspace ? <p className="text-ink-muted">Your {workspace.name.toLowerCase()} workspace is ready.</p> : null}
    </main>
  );
}
