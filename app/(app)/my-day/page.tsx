import type { Metadata } from "next";
import { getProfile, requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "My day · FollowThrough" };

export default async function MyDayPage() {
  const session = await requireSession();
  const profile = await getProfile(session);
  const { data: workspace } = await session.supabase.from("workspaces").select("name").limit(1).maybeSingle();
  const name = profile?.full_name || session.email;

  return (
    <main className="flex flex-col gap-3 py-8">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">My day</h1>
      {name ? <p className="text-ink-muted">Signed in as {name}.</p> : null}
      {workspace ? <p className="text-ink-muted">Your workspace is ready.</p> : null}
    </main>
  );
}
