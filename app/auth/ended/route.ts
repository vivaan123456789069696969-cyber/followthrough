import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where a device lands when its account no longer exists, for example after it was
 * deleted on another device. Clears this device's session, but only when the account
 * really is gone, so a link to here can't sign anyone out.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims().catch(() => ({ data: null }));
  const userId = data?.claims?.sub;

  if (userId) {
    const { data: profile, error } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (error || profile) return NextResponse.redirect(new URL("/my-day", request.url));
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  return NextResponse.redirect(new URL("/?account=ended", request.url));
}
