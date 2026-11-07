import { Badge, Card } from "./ui";

/**
 * The two sources and their honest state. Wispr Flow is import only; there is no live
 * connection to claim. Google is turned on in Settings, if this app has it set up.
 */
export function SourceCards({ googleAvailable }: { googleAvailable: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-ink">Wispr Flow</h3>
          <Badge tone="plain">Import</Badge>
        </div>
        <p className="text-ink-muted">Meeting notes and transcripts.</p>
        <p className="text-sm text-ink">
          Paste or upload notes from Wispr Flow when you add notes to a meeting. FollowThrough reads only what you give it.
        </p>
        <p className="text-sm text-ink-muted">A direct connection to Wispr Flow needs checking with Wispr first, so there isn&apos;t one.</p>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-ink">Google Calendar</h3>
          <Badge tone={googleAvailable ? "plain" : "lilac"}>{googleAvailable ? "Optional" : "Not set up"}</Badge>
        </div>
        <p className="text-ink-muted">Meeting context and schedule.</p>
        <div className="text-sm text-ink">
          <p>Google asks you for one thing at a time:</p>
          <ul className="mt-1 list-disc pl-5">
            <li>To use your meetings: seeing your calendar events, to fill in meeting titles, times and attendees.</li>
            <li>
              Only if you also want due dates in Calendar: a separate FollowThrough calendar for them. Your other events aren&apos;t changed.
            </li>
          </ul>
        </div>
        <p className="text-sm text-ink-muted">
          {googleAvailable ? "Turn it on in Settings, under Google." : "Google isn't set up on this app yet."}
        </p>
      </Card>
    </div>
  );
}
