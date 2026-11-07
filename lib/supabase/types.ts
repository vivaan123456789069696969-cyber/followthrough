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
      suggestions: Table<
        {
          id: string;
          note_id: string;
          workspace_id: string;
          title: string;
          owner_name: string | null;
          owner_contact_id: string | null;
          due_date: string | null;
          due_date_basis: string | null;
          source_quote: string;
          source_locator: { type: "timestamp" | "offset"; value: string | null; start: number; end: number; line?: number };
          confidence: "high" | "medium" | "low";
          open_questions: string[];
          status: "pending" | "confirmed" | "dismissed";
          model: string;
        } & Timestamps,
        never,
        { title?: string; owner_name?: string | null; due_date?: string | null; status?: "pending" | "confirmed" | "dismissed" }
      >;
      ai_usage: Table<
        { id: string; user_id: string; note_id: string | null; model: string; input_tokens: number; output_tokens: number; cost_usd: number } & Timestamps,
        never,
        never
      >;
    };
    Views: Record<never, never>;
    Functions: {
      reserve_ai_usage: {
        Args: {
          p_note_id: string;
          p_model: string;
          p_estimate_usd: number;
          p_monthly_cap_usd: number;
          p_hourly_limit: number;
          p_global_cap_usd?: number | null;
        };
        Returns: unknown;
      };
      settle_ai_usage: {
        Args: { p_usage_id: string; p_token: string; p_model: string; p_input_tokens: number; p_output_tokens: number; p_cost_usd: number };
        Returns: undefined;
      };
      add_suggestions: { Args: { p_note_id: string; p_model: string; p_items: unknown }; Returns: number };
      confirm_suggestion: {
        Args: { p_suggestion_id: string; p_title: string; p_owner_kind: string; p_owner_name: string | null; p_due_date: string | null };
        Returns: string;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
