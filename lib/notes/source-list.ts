// Where notes come from. The add-notes form and setup render from this list, so a new
// source is added here once. Wispr Flow has no verified public API, so its direct
// connection is listed as needing validation and is never offered as working.
// No parsing here: this file is also used in the browser.

export type SourceId = "notes" | "wispr_import" | "wispr_api";

export type NotesSource = {
  id: SourceId;
  label: string;
  description: string;
  status: "available" | "needs_validation";
};

export const NOTE_SOURCES: NotesSource[] = [
  {
    id: "notes",
    label: "Notes or a transcript",
    description: "Typed or pasted notes, or a file such as a meeting transcript.",
    status: "available",
  },
  {
    id: "wispr_import",
    label: "Wispr Flow",
    description: "Notes you've written with Wispr Flow, pasted or uploaded. FollowThrough reads only what you give it.",
    status: "available",
  },
  {
    id: "wispr_api",
    label: "Direct connection to Wispr Flow",
    description: "There's no direct connection to Wispr Flow yet. Paste or upload your notes instead.",
    status: "needs_validation",
  },
];

export const selectableSources = () => NOTE_SOURCES.filter((source) => source.status === "available");

export function isSelectableSource(value: unknown): value is "notes" | "wispr_import" {
  return selectableSources().some((source) => source.id === value);
}
