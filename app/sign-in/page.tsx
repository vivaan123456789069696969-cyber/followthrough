import type { Metadata } from "next";
import { secondaryButton } from "@/components/button-styles";
import { MagicLinkForm } from "@/components/magic-link-form";
import { safeNextPath } from "@/lib/auth/routes";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { sendMagicLink, signInWithGoogle } from "./actions";

export const metadata: Metadata = { title: "Sign in · FollowThrough" };

const errors: Record<string, string> = {
  link: "That link didn't work or has expired. Send a new one.",
  google: "We couldn't reach Google. Try again.",
};

type Props = { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> };

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const error = typeof params.error === "string" ? errors[params.error] : undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <p className="text-base font-semibold tracking-tight text-brand">followthrough</p>
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Sign in</h1>

      {error ? (
        <p role="alert" className="rounded-lg bg-warm p-3 text-on-warm">
          {error}
        </p>
      ) : null}

      {getSupabaseEnv() ? (
        <>
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <button type="submit" className={`${secondaryButton} w-full`}>
              Continue with Google
            </button>
          </form>
          <p className="text-center text-ink-muted">or</p>
          <MagicLinkForm action={sendMagicLink} next={next} />
        </>
      ) : (
        <p role="status" className="rounded-lg bg-sage-100 p-4 text-ink">
          Sign-in isn&apos;t set up yet. Add the Supabase settings to continue.
        </p>
      )}
    </main>
  );
}
