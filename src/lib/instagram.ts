import "server-only";
import { config } from "@/lib/config";

// Sends a real Instagram DM reply via the Send API. Every reply through this
// app is typed and sent by an actual staff member (never an automated/bot
// response), so every send uses the HUMAN_AGENT message tag — this extends
// the reply window from Instagram's normal ~24 hours since the person's last
// message to 7 days, which matters here since a real admission enquiry can
// easily arrive on a Friday evening or over a weekend. Never throws — a
// boundary function like src/lib/zoom.ts, so a failure (most commonly that
// even the 7-day window has closed — a hard platform rule with no further
// workaround) surfaces as a typed result the caller can show the rep, not a
// crash.
export async function sendInstagramMessage(
  igsid: string,
  text: string,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/v20.0/me/messages?access_token=${encodeURIComponent(config.notifications.instagramToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: igsid },
          message: { text },
          messaging_type: "MESSAGE_TAG",
          tag: "HUMAN_AGENT",
        }),
      },
    );
    const json = (await res.json()) as { message_id?: string; error?: { message?: string } };
    if (!res.ok) {
      return { ok: false, error: json.error?.message ?? `Instagram send failed (${res.status})` };
    }
    return { ok: true, messageId: json.message_id ?? "" };
  } catch (err) {
    console.error("[instagram] send failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "Instagram send failed" };
  }
}
