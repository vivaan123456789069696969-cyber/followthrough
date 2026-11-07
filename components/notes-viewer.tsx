import type { ReactNode } from "react";

type Status = "pending" | "confirmed" | "dismissed";
type Span = { id: string; start: number; end: number; status: Status };

// Colour plus a second cue for each state, so it never relies on colour alone.
const STYLES: Record<Status, string> = {
  pending: "bg-lime text-on-lime underline decoration-2 underline-offset-2",
  confirmed: "bg-sage-100",
  dismissed: "bg-transparent underline decoration-dotted",
};
const SPOKEN: Record<Status, string> = { pending: "Suggested", confirmed: "Confirmed", dismissed: "Dismissed" };

/**
 * The notes exactly as stored, with each suggestion's words marked so cards can link to
 * them. Offsets count characters, as stored by the database, so emoji don't shift them.
 */
export function NotesViewer({ text, spans }: { text: string; spans: Span[] }) {
  const characters = Array.from(text);
  const slice = (from: number, to?: number) => characters.slice(from, to).join("");
  const parts: ReactNode[] = [];
  let at = 0;

  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.end > characters.length || span.end <= span.start) continue;
    // Words already marked by another suggestion still get a link target here.
    if (span.start < at) {
      parts.push(<span key={span.id} id={`quote-${span.id}`} className="scroll-mt-24" />);
      continue;
    }
    if (span.start > at) parts.push(slice(at, span.start));
    parts.push(
      <mark key={span.id} id={`quote-${span.id}`} className={`scroll-mt-24 rounded px-0.5 text-ink target:outline-2 target:outline-brand ${STYLES[span.status]}`}>
        <span className="sr-only">{SPOKEN[span.status]}: </span>
        {slice(span.start, span.end)}
      </mark>,
    );
    at = span.end;
  }
  if (at < characters.length) parts.push(slice(at));

  return (
    <div className="flex flex-col gap-3">
      <div tabIndex={0} role="region" aria-label="Meeting notes" className="max-h-[70dvh] overflow-y-auto break-words whitespace-pre-wrap text-ink">
        {parts}
      </div>
      {spans.length ? (
        <p className="text-sm text-ink-muted">
          <mark className={`rounded px-0.5 text-ink ${STYLES.pending}`}>Underlined</mark> waiting for review ·{" "}
          <mark className={`rounded px-0.5 text-ink ${STYLES.confirmed}`}>Shaded</mark> confirmed ·{" "}
          <mark className={`rounded px-0.5 text-ink ${STYLES.dismissed}`}>Dotted</mark> dismissed
        </p>
      ) : null}
    </div>
  );
}
