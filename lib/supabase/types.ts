// Hand-written stand-in covering only the tables the app reads so far.
// `npm run db:types` replaces this file with generated types for every table
// once a Supabase project is linked.

type Table<Row, Insert, Update> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

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
          created_at: string;
          updated_at: string;
        },
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
        {
          id: string;
          name: string;
          kind: "personal" | "team";
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        never,
        { name?: string }
      >;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
