import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { secondaryButton } from "@/components/button-styles";
import { BulkConfirm } from "@/components/bulk-confirm";
import { NotesViewer } from "@/components/notes-viewer";
import { RestoreSuggestion } from "@/components/restore-suggestion";
import { ReviewFocus, ReviewShortcuts } from "@/components/review-shortcuts";
import { SuggestionCard, type CardSuggestion } from "@/components/suggestion-card";
import { Card } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";
import { getMeeting } from "@/lib/data/meetings";
import { getNote, listSuggestions, looksLikeMe, type SuggestionData } from "@/lib/data/suggestions";
import { dueLabel, longDate } from "@/lib/tasks/dates";

export const metadata: Metadata = { title: "Review actions · FollowThrough" };

const SOURCE_NAMES: Record<string, string> = {
  paste: "Pasted notes",
  txt: "Notes file",
  md: "Notes file",
  vtt: "Meeting transcript",
  srt: "Meeting transcript",
  docx: "Word file",
  wispr_import: "Wispr Flow notes",
};

function sourceLabel(format: string, suggestion: SuggestionData): string {
  const name = SOURCE_NAMES[format] ?? "Notes";
  const locator = suggestion.source_locator;
  if (locator.type === "timestamp" && locator.value) return `${name} · ${locator.value}`;
  return locator.line ? `${name} · line ${locator.line}` : name;
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ note?: string; removed?: string }>;
}) {
  const context = await getAppContext();
  const { id } = await params;
  const { note: noteId, removed } = await searchParams;

  const meeting = await getMeeting(context, id);
  const note = noteId ? await getNote(context, noteId) : null;
  if (!meeting || !note || note.meeting_id !== meeting.id) notFound();

  const suggestions = await listSuggestions(context, note.id);
  const pending = suggestions.filter((suggestion) => suggestion.status === "pending");
  const dismissed = suggestions.filter((suggestion) => suggestion.status === "dismissed");
  const confirmedCount = suggestions.filter((suggestion) => suggestion.status === "confirmed").length;
  const removedCount = Number(removed) > 0 ? Number(removed) : 0;
  const fullName = context.profile?.full_name;

  const cards: CardSuggestion[] = pending.map((suggestion) => ({
    id: suggestion.id,
    title: suggestion.title,
    owner_name: suggestion.owner_name,
    owner_is_me: looksLikeMe(suggestion.owner_name, fullName),
    due_date: suggestion.due_date,
    due_label: suggestion.due_date ? `${longDate(suggestion.due_date)} · ${dueLabel(suggestion.due_date, context.today).label}` : null,
    due_date_basis: suggestion.due_date_basis,
    source_quote: suggestion.source_quote,
    source_label: sourceLabel(note.source_format, suggestion),
    open_questions: suggestion.open_questions,
  }));

  // Anything with an open question needs a look on its own, so it isn't confirmed in bulk.
  const complete = pending
    .filter((suggestion) => suggestion.owner_name && suggestion.due_date && !suggestion.open_questions.length)
    .map((suggestion) => ({
      id: suggestion.id,
      title: suggestion.title,
      owner: looksLikeMe(suggestion.owner_name, fullName) ? "You" : suggestion.owner_name!,
      due: longDate(suggestion.due_date!),
    }));

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
          <Link href={`/meetings/${meeting.id}`} className="underline">
            {meeting.title}
          </Link>{" "}
          / Review
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Suggested actions</h1>
        <p className="text-ink-muted">Check each one against the notes. Nothing becomes a task until you confirm it.</p>
      </header>

      {removedCount ? (
        <p role="status" className="rounded-lg bg-warm p-3 text-on-warm">
          {removedCount === 1
            ? "1 suggestion was removed because its words couldn't be found in the notes."
            : `${removedCount} suggestions were removed because their words couldn't be found in the notes.`}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section id="suggestion-list" aria-labelledby="suggestions-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="suggestions-heading" tabIndex={-1} className="text-lg font-semibold text-ink focus-visible:outline-2">
              {pending.length ? `${pending.length} to review` : "All reviewed"}
            </h2>
            <BulkConfirm noteId={note.id} items={complete} />
          </div>
          <ReviewFocus listId="suggestion-list" headingId="suggestions-heading" pending={pending.length} confirmed={confirmedCount} />
          {pending.length ? <ReviewShortcuts listId="suggestion-list" /> : null}

          {cards.map((card) => (
            <SuggestionCard key={card.id} suggestion={card} />
          ))}

          {!suggestions.length ? (
            <Card className="flex flex-col items-start gap-3 p-5">
              <p className="font-medium text-ink">No actions found. Add one yourself.</p>
              <Link href={`/tasks/new?meeting=${meeting.id}&return_to=${encodeURIComponent(`/meetings/${meeting.id}`)}`} className={secondaryButton}>
                Add action
              </Link>
            </Card>
          ) : null}

          {!pending.length && suggestions.length ? (
            <Card className="flex flex-col items-start gap-3 p-5">
              <p className="text-ink">
                {confirmedCount
                  ? `${confirmedCount} confirmed. Your tasks are on My day.`
                  : "Nothing was confirmed from these notes. You can restore a dismissed suggestion or add an action yourself."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/my-day" className={secondaryButton}>
                  Go to My day
                </Link>
                <Link href={`/tasks/new?meeting=${meeting.id}&return_to=${encodeURIComponent(`/meetings/${meeting.id}`)}`} className={secondaryButton}>
                  Add action
                </Link>
              </div>
            </Card>
          ) : null}

          {dismissed.length ? (
            <details className="rounded-lg border border-line p-3">
              <summary className="min-h-8 cursor-pointer font-medium">Dismissed ({dismissed.length})</summary>
              <ul className="mt-3 flex flex-col gap-2">
                {dismissed.map((suggestion) => (
                  <li key={suggestion.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="break-words text-ink-muted">{suggestion.title}</span>
                    <RestoreSuggestion id={suggestion.id} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section aria-labelledby="notes-heading" className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
          <h2 id="notes-heading" className="text-lg font-semibold text-ink">
            Meeting notes
          </h2>
          <Card className="p-4">
            <NotesViewer
              text={note.raw_text}
              spans={suggestions.map((suggestion) => ({
                id: suggestion.id,
                start: suggestion.source_locator.start,
                end: suggestion.source_locator.end,
                status: suggestion.status,
              }))}
            />
          </Card>
        </section>
      </div>
    </main>
  );
}
