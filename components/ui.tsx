import Link from "next/link";
import type { ReactNode } from "react";
import { primaryButton } from "./button-styles";

export const inputClass = "min-h-11 w-full rounded-lg border border-ink-muted bg-surface px-3 text-base text-ink";
export const labelClass = "font-medium text-ink";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</div>;
}

/** Status always pairs words with a mark, so it never relies on color alone. */
export function Badge({ tone, children }: { tone: "warm" | "lilac" | "lime" | "plain"; children: ReactNode }) {
  const tones = {
    warm: "bg-warm text-on-warm",
    lilac: "bg-lilac text-on-lilac",
    lime: "bg-lime text-on-lime",
    plain: "bg-sage-100 text-ink",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium ${tones[tone]}`}>{children}</span>;
}

export function EmptyState({ title, body, href, action }: { title: string; body: string; href: string; action: string }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="text-ink-muted">{body}</p>
      <Link href={href} className={primaryButton}>
        {action}
      </Link>
    </Card>
  );
}

export function FormError({ id, message }: { id?: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="rounded-lg bg-warm p-3 text-on-warm">
      {message}
    </p>
  );
}
