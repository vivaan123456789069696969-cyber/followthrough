"use client";

import { signOut } from "@/app/(app)/actions";
import { primaryButton, secondaryButton } from "@/components/button-styles";

/** Offers a way out even when a private page can't load, including signing out. */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
      <p className="text-base font-semibold tracking-tight text-brand">followthrough</p>
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Something went wrong</h1>
      <p className="text-ink-muted">This page couldn&apos;t load. Your work is safe. Try again in a moment.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={primaryButton}>
          Try again
        </button>
        <form action={signOut}>
          <button type="submit" className={secondaryButton}>
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
