import "server-only";
import { config } from "@/lib/config";

// Sends a real Facebook Page Messenger reply via the Send API. Mirrors
// sendInstagramMessage (src/lib/instagram.ts) exactly — same plain-send,
// then HUMAN_AGENT-tag-fallback-on-failure shape, same boundary-function
// contract (never throws).
export async function sendFacebookMessage(
  psid: string,
  text: string,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const plain = await attemptSend(psid, text, false);
  if (plain.ok) return plain;

  const tagged = await attemptSend(psid, text, true);
  return tagged.ok ? tagged : plain;
}

async function attemptSend(
  psid: string,
  text: string,
  useHumanAgentTag: boolean,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(config.notifications.facebookPageToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: psid },
          message: { text },
          ...(useHumanAgentTag ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}),
        }),
      },
    );
    const json = (await res.json()) as { message_id?: string; error?: { message?: string } };
    if (!res.ok) {
      return { ok: false, error: json.error?.message ?? `Facebook send failed (${res.status})` };
    }
    return { ok: true, messageId: json.message_id ?? "" };
  } catch (err) {
    console.error("[facebook] send failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "Facebook send failed" };
  }
}
