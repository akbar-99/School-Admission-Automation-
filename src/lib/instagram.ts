import "server-only";
import { config } from "@/lib/config";

// Sends a real Instagram DM reply via the Send API. Never throws — a boundary
// function like src/lib/zoom.ts, so a failure (most commonly the ~24-hour
// messaging window having closed since the person's last message — a hard
// Instagram platform rule with no template-message workaround) surfaces as a
// typed result the caller can show directly to the rep, not a crash.
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
        body: JSON.stringify({ recipient: { id: igsid }, message: { text } }),
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
