// Hand-written stand-in covering only the tables the app uses so far.
// `npm run db:types` replaces this file with generated types for every table
// once a Supabase project is linked.

type Table<Row, Insert, Update> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

type Timestamps = { created_at: string; updated_at: string };
export type TaskStatus = "open" | "done" | "dismissed";
export type TaskEventType = "created" | "edited" | "done" | "reopened" | "snoozed" | "synced" | "reminded";
export type NoteFormat = "paste" | "txt" | "md" | "vtt" | "srt" | "docx" | "wispr_import";

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          timezone: string | null;
          onboarding_done: boolean;
          note_retention_days: number | null;
        } & Timestamps,
        never,
        {
          full_name?: string | null;
          avatar_url?: string | null;
          timezone?: string | null;
          onboarding_done?: boolean;
          note_retention_days?: number | null;
        }
      >;
      workspaces: Table<
        { id: string; name: string; kind: "personal" | "team"; created_by: string } & Timestamps,
        never,
        { name?: string }
      >;
      workspace_members: Table<
        { id: string; workspace_id: string; user_id: string; role: "owner" | "admin" | "member" } & Timestamps,
        never,
        never
      >;
      contacts: Table<
        { id: string; workspace_id: string; display_name: string; email: string | null; linked_user_id: string | null } & Timestamps,
        { workspace_id: string; display_name: string; email?: string | null },
        { display_name?: string; email?: string | null }
      >;
      meetings: Table<
        {
          id: string;
          workspace_id: string;
          title: string;
          starts_at: string;
          source: "manual" | "google_calendar" | "wispr_import";
          external_event_id: string | null;
          attendees: string[];
        } & Timestamps,
        { workspace_id: string; title: string; starts_at: string; attendees?: string[] },
        { title?: string; starts_at?: string; attendees?: string[] }
      >;
      meeting_notes: Table<
        {
          id: string;
          meeting_id: string;
          workspace_id: string;
          raw_text: string;
          source_format: NoteFormat;
          has_timestamps: boolean;
          content_hash: string;
          created_by: string | null;
        } & Timestamps,
        {
          meeting_id: string;
          workspace_id: string;
          raw_text: string;
          source_format: NoteFormat;
          has_timestamps: boolean;
          created_by: string;
        },
        never
      >;
      tasks: Table<
        {
          id: string;
          workspace_id: string;
          meeting_id: string | null;
          suggestion_id: string | null;
          title: string;
          description: string | null;
          owner_user_id: string | null;
          owner_contact_id: string | null;
          due_date: string | null;
          snoozed_until: string | null;
          status: TaskStatus;
          source_quote: string | null;
          source_locator: unknown;
          completed_at: string | null;
          created_by: string | null;
        } & Timestamps,
        {
          workspace_id: string;
          meeting_id?: string | null;
          title: string;
          description?: string | null;
          owner_user_id?: string | null;
          owner_contact_id?: string | null;
          due_date?: string | null;
          created_by: string;
        },
        {
          title?: string;
          description?: string | null;
          owner_user_id?: string | null;
          owner_contact_id?: string | null;
          due_date?: string | null;
          snoozed_until?: string | null;
          status?: TaskStatus;
          completed_at?: string | null;
        }
      >;
      task_events: Table<
        { id: string; task_id: string; workspace_id: string; actor_id: string | null; type: TaskEventType; payload: unknown } & Timestamps,
        { task_id: string; workspace_id: string; actor_id: string; type: TaskEventType },
        never
      >;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
