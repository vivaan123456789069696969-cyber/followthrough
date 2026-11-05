---
name: wispr-import-adapter
description: Use when adding Wispr Flow note import (paste/file) and the connector adapter slot. Never claim a live Wispr connection.
---
# Wispr Flow Import Adapter

## Truth first
The concept deck states the Wispr Flow integration **needs validation**. We have no verified public API. This release supports **manual import** and a **future connector slot** only.
At the start of this phase: (1) ask the user if they have Wispr export samples or API docs; (2) ask the user to supply 2–3 real exported samples (anonymized). Do not guess the export format.

## Interface
```ts
interface NotesSource {
  id: 'paste' | 'file' | 'wispr_import' | 'wispr_api'; // wispr_api = future, disabled
  label: string;
  status: 'available' | 'needs_validation';
  parse(input: File | string): Promise<{ title?: string; startsAt?: Date; text: string; hasTimestamps: boolean }>;
}
```
Register sources in one registry file; UI renders from the registry.

## UI
In Setup and Meeting → Add notes: "Import from Wispr Flow" (paste or upload). A disabled card "Direct connection — coming after validation" with a short honest note. No fake OAuth buttons, no "Connected" badge.

## Parsing
Accept `.txt/.md/.vtt/.srt` plus whatever sample formats the user provides. Normalize to the same note format used by extraction; preserve raw text; detect timestamps and speakers; strip only obvious non-content (BOM, control chars). Size/type validation server-side.

## Tests
One fixture per supported format; malformed file; oversized file; non-UTF8; empty file.
