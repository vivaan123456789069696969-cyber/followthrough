import Link from "next/link";
import { primaryButton } from "@/components/button-styles";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-12 sm:px-8">
      <p className="text-base font-semibold tracking-tight text-brand">followthrough</p>
      {account === "deleted" ? (
        <p role="status" className="rounded-lg bg-sage-100 p-3 text-ink">
          Your account and everything in it were deleted.
        </p>
      ) : account === "ended" ? (
        <p role="status" className="rounded-lg bg-sage-100 p-3 text-ink">
          You were signed out because this account no longer exists.
        </p>
      ) : null}
      <h1 className="text-4xl font-semibold tracking-tight text-balance text-ink sm:text-5xl">
        Meetings end. <span className="whitespace-nowrap">Follow-through</span> starts.
      </h1>
      <p className="text-lg text-ink-muted">
        A workspace that turns meeting notes into clear, owned actions people can actually follow.
      </p>
      <p>
        <Link href="/sign-in" className={primaryButton}>
          Sign in
        </Link>
      </p>
    </main>
  );
}
