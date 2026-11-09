import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton } from "@/components/button-styles";

// The page's address holds a signed link, so it's never passed on to other sites.
export const metadata: Metadata = { title: "Turn off reminders · FollowThrough", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * Where "Turn off reminders" in an email leads. Asks first, so opening the link (or a mail
 * scanner opening it) changes nothing; the button does it, no sign-in needed.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { u, s, done, invalid, preview } = await searchParams;

  let body;
  if (done) {
    body = (
      <>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Reminders are off</h1>
        <p className="text-ink">You won&apos;t get reminder emails from FollowThrough. You can turn them on again in Settings.</p>
      </>
    );
  } else if (preview) {
    body = <p className="text-ink">This is the link people use to turn off reminders. In a preview it does nothing.</p>;
  } else if (invalid || !u || !s) {
    body = (
      <>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">This link doesn&apos;t work</h1>
        <p className="text-ink">It may be from an old email. You can turn reminders off in Settings after signing in.</p>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Turn off reminder emails?</h1>
        <p className="text-ink">FollowThrough will stop sending you reminders. Your tasks stay as they are.</p>
        <form method="post" action="/api/unsubscribe">
          <input type="hidden" name="u" value={u} />
          <input type="hidden" name="s" value={s} />
          <input type="hidden" name="source" value="page" />
          <button type="submit" className={primaryButton}>
            Turn off reminders
          </button>
        </form>
      </>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-4 py-12">
      <p className="text-base font-semibold tracking-tight text-brand">followthrough</p>
      {body}
      <p>
        <Link href="/settings" className="text-brand underline">
          Go to Settings
        </Link>
      </p>
    </main>
  );
}
