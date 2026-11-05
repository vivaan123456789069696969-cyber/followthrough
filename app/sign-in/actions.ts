"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/lib/auth/routes";
import { getAppUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type EmailSignInState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const emailSchema = z.email().max(320);

function callbackUrl(next: FormDataEntryValue | null) {
  const path = safeNextPath(typeof next === "string" ? next : null);
  return `${getAppUrl()}/auth/callback?next=${encodeURIComponent(path)}`;
}

export async function sendMagicLink(_previous: EmailSignInState, formData: FormData): Promise<EmailSignInState> {
  const email = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) return { status: "error", message: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: callbackUrl(formData.get("next")) },
  });

  if (error) {
    console.error(JSON.stringify({ event: "magic_link_failed", code: error.code ?? "unknown", status: error.status }));
    return {
      status: "error",
      message: error.status === 429 ? "Too many requests. Try again in a minute." : "We couldn't send the link. Try again.",
    };
  }

  return { status: "sent", email: email.data };
}

export async function signInWithGoogle(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(formData.get("next")) },
  });

  if (error || !data.url) {
    console.error(JSON.stringify({ event: "google_sign_in_failed", code: error?.code ?? "no_url" }));
    redirect("/sign-in?error=google");
  }

  redirect(data.url);
}
