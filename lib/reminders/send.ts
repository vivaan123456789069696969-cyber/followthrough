import "server-only";
import { testSwitch } from "@/lib/test-switches";

// Sends through Resend's API, or only logs when sending isn't switched on. Logs never
// include addresses or task text.

export type Outgoing = { to: string; subject: string; html: string; text: string; headers: Record<string, string> };
export type SendResult = { sent: true; id: string } | { sent: false; logged: true } | { sent: false; logged: false; reason: string };

export function sendingEnabled(): boolean {
  return process.env.RESEND_ENABLED === "true" && Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

function apiUrl(): string {
  // Tests point this at a stand-in, and only with the test switch on.
  const override = testSwitch("RESEND_TEST_ENDPOINTS") ? process.env.RESEND_API_URL : undefined;
  return override || "https://api.resend.com/emails";
}

export async function sendEmail(email: Outgoing, idempotencyKey: string): Promise<SendResult> {
  if (!sendingEnabled()) {
    console.info(JSON.stringify({ event: "reminder_logged_not_sent" }));
    return { sent: false, logged: true };
  }
  try {
    const response = await fetch(apiUrl(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
        // Resend drops a repeat with the same key, a second guard against double sends.
        "idempotency-key": idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: [email.to],
        ...(process.env.RESEND_REPLY_TO ? { reply_to: process.env.RESEND_REPLY_TO } : {}),
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { sent: false, logged: false, reason: `resend_${response.status}` };
    const body = (await response.json()) as { id?: string };
    return { sent: true, id: String(body.id ?? "").slice(0, 200) };
  } catch (error) {
    return { sent: false, logged: false, reason: error instanceof Error ? error.name : "unknown" };
  }
}
