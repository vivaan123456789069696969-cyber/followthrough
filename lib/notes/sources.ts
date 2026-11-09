import "server-only";
import { parseNoteFile, stripNonContent, validateNoteText, type ParsedNote } from "./parse";

export { isSelectableSource, NOTE_SOURCES, selectableSources, type NotesSource, type SourceId } from "./source-list";

/** The same cleaning every note gets: only characters that are never words are removed. */
export const stripControlCharacters = stripNonContent;

/**
 * Wispr Flow notes, pasted or from a file. They get exactly the checks and cleaning any
 * other note gets, so a character is treated the same whichever way it arrives.
 */
export async function parseWispr(input: { text?: string; file?: { name: string; bytes: ArrayBuffer } }): Promise<ParsedNote> {
  if (input.file) return parseNoteFile(input.file.name, input.file.bytes);
  return validateNoteText(input.text ?? "");
}
