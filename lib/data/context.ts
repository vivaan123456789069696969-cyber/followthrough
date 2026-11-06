import "server-only";
import { cache } from "react";
import { getProfile, requireSession } from "@/lib/auth/session";
import { safeTimezone, todayInZone } from "@/lib/tasks/dates";

/** Who is asking and where, once per request. Every read and write starts here. */
export const getAppContext = cache(async () => {
  const session = await requireSession();
  const profile = await getProfile(session);

  const { data: membership, error } = await session.supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", session.userId)
    .limit(1)
    .maybeSingle();
  if (error || !membership) throw new Error("Could not load workspace");

  const timezone = safeTimezone(profile?.timezone);

  return {
    ...session,
    profile,
    workspaceId: membership.workspace_id,
    timezone,
    today: todayInZone(timezone),
  };
});

export type AppContext = Awaited<ReturnType<typeof getAppContext>>;
