// Puts the deck's demo scenario (Maya Chen, Product sync) into one existing account.
//
//   npm run seed -- you@example.com
//
// Dev only: it refuses to run unless the database is the dev project named by
// TEST_SUPABASE_DEV_PROJECT_REF. It never creates accounts or passwords; sign in first,
// then seed that account. Running it again replaces the demo meeting, not anything else.
import { createClient } from "@supabase/supabase-js";
import { buildDemo, DEMO_TITLE } from "./seed-data.mjs";

const email = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY;
const devRef = process.env.TEST_SUPABASE_DEV_PROJECT_REF;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!email) fail("Usage: npm run seed -- you@example.com (an account that has already signed in)");
if (!url || !secret) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
if (!devRef) fail("Set TEST_SUPABASE_DEV_PROJECT_REF to the dev project's ref. Seeding refuses to run without it.");
if (!new URL(url).hostname.startsWith(`${devRef}.`)) fail("NEXT_PUBLIC_SUPABASE_URL isn't the dev project, so nothing was written. Demo data is for the dev project only.");

const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const check = (result, what) => {
  if (result.error) fail(`${what} failed: ${result.error.code ?? ""} ${result.error.message}`);
  return result.data;
};

// Find the account by its email address.
let user;
for (let page = 1; page <= 20 && !user; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) fail(`Couldn't look up accounts: ${error.message}`);
  user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (data.users.length < 200) break;
}
if (!user) fail(`No account for ${email}. Sign in to the app with it once, then run this again.`);

const member = check(await db.from("workspace_members").select("workspace_id").eq("user_id", user.id).order("created_at").limit(1).maybeSingle(), "Finding the workspace");
if (!member) fail("That account has no workspace yet. Open the app once, then run this again.");
const workspace = member.workspace_id;

// "Today" in the person's own timezone, so "Thursday" and the dates are right for them.
const profile = check(await db.from("profiles").select("timezone").eq("id", user.id).maybeSingle(), "Reading the profile");
let zone = "UTC";
try {
  zone = new Intl.DateTimeFormat("en-US", { timeZone: profile?.timezone ?? "UTC" }).resolvedOptions().timeZone;
} catch {
  // An unknown timezone name falls back to UTC.
}
const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
const demo = buildDemo(today);

// Replace an earlier demo. Deleting a meeting keeps the tasks made from it (they keep their
// source), so the earlier demo's tasks are removed first, or each run would add a second pair.
const earlier = check(await db.from("meetings").select("id").eq("workspace_id", workspace).eq("title", DEMO_TITLE), "Finding the earlier demo");
if (earlier.length) {
  const ids = earlier.map((row) => row.id);
  check(await db.from("tasks").delete().eq("workspace_id", workspace).in("meeting_id", ids), "Clearing the earlier demo's tasks");
  check(await db.from("meetings").delete().eq("workspace_id", workspace).in("id", ids), "Clearing the earlier demo");
}

const meeting = check(
  await db.from("meetings").insert({ workspace_id: workspace, title: demo.meeting.title, starts_at: demo.meeting.startsAt, attendees: demo.meeting.attendees }).select("id").single(),
  "Adding the meeting",
);
const note = check(
  await db
    .from("meeting_notes")
    .insert({ meeting_id: meeting.id, workspace_id: workspace, raw_text: demo.notes, source_format: "paste", has_timestamps: true, created_by: user.id })
    .select("id")
    .single(),
  "Adding the notes",
);

const contacts = new Map();
for (const name of demo.contacts) {
  const existing = check(await db.from("contacts").select("id").eq("workspace_id", workspace).ilike("display_name", name).maybeSingle(), "Finding a contact");
  contacts.set(name, existing?.id ?? check(await db.from("contacts").insert({ workspace_id: workspace, display_name: name }).select("id").single(), "Adding a contact").id);
}

const suggestion = (item, status) => ({
  note_id: note.id,
  workspace_id: workspace,
  title: item.title,
  owner_name: item.ownerName,
  due_date: item.dueDate,
  due_date_basis: item.basis,
  source_quote: item.quote,
  source_locator: item.locator,
  confidence: "high",
  open_questions: item.questions ?? [],
  status,
  model: "demo",
});

for (const item of demo.confirmed) {
  const row = check(await db.from("suggestions").insert(suggestion(item, "confirmed")).select("id").single(), "Adding a suggestion");
  check(
    await db.from("tasks").insert({
      workspace_id: workspace,
      meeting_id: meeting.id,
      suggestion_id: row.id,
      title: item.title,
      owner_user_id: item.owner === "me" ? user.id : null,
      owner_contact_id: item.owner === "me" ? null : contacts.get(item.owner),
      due_date: item.dueDate,
      source_quote: item.quote,
      source_locator: item.locator,
      created_by: user.id,
    }),
    "Adding a task",
  );
}
for (const item of demo.pending) check(await db.from("suggestions").insert(suggestion(item, "pending")), "Adding a suggestion");

console.log(`Done. Added "${DEMO_TITLE}" with its notes, ${demo.confirmed.length} confirmed tasks and ${demo.pending.length} suggestions to ${email}.`);
