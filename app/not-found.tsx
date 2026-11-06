import Link from "next/link";
import { primaryButton } from "@/components/button-styles";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">We couldn&apos;t find that</h1>
      <p className="text-ink-muted">It may have been deleted, or the link may be wrong.</p>
      <div>
        <Link href="/my-day" className={primaryButton}>
          Go to My day
        </Link>
      </div>
    </main>
  );
}
