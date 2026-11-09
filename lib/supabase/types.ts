// Hand-written stand-in covering only the tables the app uses so far.
// `npm run db:types` replaces this file with generated types for every table
// once a Supabase project is linked.

type Table<Row, Insert, Update> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

type Timestamps = { created_at: string; updated_at: string };
export type TaskStatus = "open" | "done" | "dismissed";
export type TaskEventType = "created" | "edited" | "done" | "reopened" | "snoozed" | "synced" | "reminded";
export type SyncProvider = "google_tasks" | "google_calendar";
export type SyncState = "pending" | "ok" | "failed";
export type NoteFormat ="paste" | "txt" | "md" | "vtt" | "srt" | "docx" | "wispr_import";

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
          task_destination: "app" | "google_tasks" | null;
        } & Timestamps,
        never,
        {
          full_name?: string | null;
          avatar_url?: string | null;
          timezone?: string | null;
          onboarding_done?: boolean;
          note_retention_days?: number | null;
          task_destination?: "app" | "google_tasks" | null;
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
        {
          workspace_id: string;
          title: string;
          starts_at: string;
          attendees?: string[];
          // Only the server's admin client can set these; users' inserts are refused.
          source?: "manual" | "google_calendar" | "wispr_import";
          external_event_id?: string | null;
        },
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
        { id: string; user_id: string | null; note_id: string | null; model: string; input_tokens: number; output_tokens: number; cost_usd: number } & Timestamps,
        never,
        never
      >;
      integrations: Table<
        {
          id: string;
          workspace_id: string;
          user_id: string;
          provider: "google";
          scopes: string[];
          access_token_enc: string | null;
          refresh_token_enc: string | null;
          expires_at: string | null;
          status: "active" | "needs_reconnect" | "revoked";
          calendar_id: string | null;
          tasklist_id: string | null;
        } & Timestamps,
        {
          workspace_id: string;
          user_id: string;
          provider: "google";
          scopes?: string[];
          access_token_enc?: string | null;
          refresh_token_enc?: string | null;
          expires_at?: string | null;
          status?: "active" | "needs_reconnect" | "revoked";
          calendar_id?: string | null;
          tasklist_id?: string | null;
        },
        {
          scopes?: string[];
          access_token_enc?: string | null;
          refresh_token_enc?: string | null;
          expires_at?: string | null;
          status?: "active" | "needs_reconnect" | "revoked";
          calendar_id?: string | null;
          tasklist_id?: string | null;
        }
      >;
      reminder_prefs: Table<
        {
          id: string;
          user_id: string;
          enabled: boolean;
          digest_time: string | null;
          day_before: boolean;
          quiet_start: string | null;
          quiet_end: string | null;
          types: Record<string, unknown> | null;
          // Readable by the server's admin client only.
          unsubscribe_token: string;
        } & Timestamps,
        {
          user_id: string;
          enabled?: boolean;
          digest_time?: string | null;
          day_before?: boolean;
          quiet_start?: string | null;
          quiet_end?: string | null;
          types?: Record<string, unknown>;
        },
        {
          enabled?: boolean;
          digest_time?: string | null;
          day_before?: boolean;
          quiet_start?: string | null;
          quiet_end?: string | null;
          types?: Record<string, unknown>;
        }
      >;
      reminder_log: Table<
        {
          id: string;
          task_id: string;
          user_id: string;
          kind: "due_today" | "due_tomorrow" | "overdue" | "waiting_weekly";
          scheduled_for: string;
          sent_at: string | null;
          resend_id: string | null;
        } & Timestamps,
        { task_id: string; user_id: string; kind: "due_today" | "due_tomorrow" | "overdue" | "waiting_weekly"; scheduled_for: string },
        { sent_at?: string | null; resend_id?: string | null }
      >;
      task_syncs: Table<
        {
          id: string;
          task_id: string;
          workspace_id: string;
          provider: SyncProvider;
          external_id: string | null;
          container_id: string | null;
          state: SyncState;
          last_error: string | null;
          last_synced_at: string | null;
          attempts: number;
          next_attempt_at: string | null;
        } & Timestamps,
        { task_id: string; workspace_id: string; provider: SyncProvider; state?: SyncState; next_attempt_at?: string | null },
        {
          external_id?: string | null;
          container_id?: string | null;
          state?: SyncState;
          last_error?: string | null;
          last_synced_at?: string | null;
          attempts?: number;
          next_attempt_at?: string | null;
        }
      >;
    };
    Views: Record<never, never>;
    Functions: {
      delete_my_account: { Args: Record<string, never>; Returns: undefined };
      reserve_ai_usage: {
        Args: {
          p_user_id: string;
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
        Args: { p_user_id: string; p_usage_id: string; p_token: string; p_model: string; p_input_tokens: number; p_output_tokens: number; p_cost_usd: number };
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
