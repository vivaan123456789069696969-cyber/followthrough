import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const PAGE = 1000;

// Everything a user can see of their own account. Row-level security limits each
// query to their rows; integration tokens can't be selected at all.
const TABLES: { name: string; columns: string }[] = [
  { name: "profiles", columns: "id, full_name, avatar_url, timezone, onboarding_done, note_retention_days, task_destination, created_at, updated_at" },
  { name: "workspaces", columns: "*" },
  { name: "workspace_members", columns: "*" },
  { name: "contacts", columns: "*" },
  { name: "meetings", columns: "*" },
  { name: "meeting_notes", columns: "*" },
  { name: "suggestions", columns: "*" },
  { name: "tasks", columns: "*" },
  { name: "task_events", columns: "*" },
  { name: "task_syncs", columns: "*" },
  { name: "reminder_log", columns: "*" },
  { name: "reminder_prefs", columns: "id, user_id, enabled, digest_time, day_before, quiet_start, quiet_end, types, created_at, updated_at" },
  { name: "integrations", columns: "id, workspace_id, user_id, provider, scopes, expires_at, status, calendar_id, tasklist_id, created_at, updated_at" },
  { name: "ai_usage", columns: "id, user_id, note_id, model, input_tokens, output_tokens, cost_usd, created_at, updated_at" },
];

/** Reads every row, a page at a time, since one request returns at most 1,000. */
async function allRows({ supabase }: Session, table: string, columns: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    // The table names are fixed above. The cast only gives the query builder a shape.
    const { data, error } = await supabase
      .from(table as "tasks")
      .select(columns)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`export_${table}_failed:${error.code}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function GET() {
  const session = await requireSession();
  try {
    const data: Record<string, unknown[]> = {};
    for (const { name, columns } of TABLES) data[name] = await allRows(session, name, columns);

    const body = JSON.stringify({ exported_at: new Date().toISOString(), format: "followthrough-export-1", data }, null, 2);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="followthrough-export-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "export_failed", code: error instanceof Error ? error.message : "unknown" }));
    return new Response("We couldn't export your data. Try again.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
}
