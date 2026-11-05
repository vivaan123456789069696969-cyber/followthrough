import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Only Next's own build files and the favicon skip this check. Paths that merely
// look like files, such as /api/meetings/x.png, still need a session.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico$).*)"],
};
