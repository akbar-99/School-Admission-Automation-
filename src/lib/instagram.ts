import "server-only";
import { config } from "@/lib/config";

// Sends a real Instagram DM reply via the Send API. Never throws — a boundary
// function like src/lib/zoom.ts, so a failure surfaces as a typed result the
// caller can show the rep, not a crash.
//
// Tries a normal reply first (works within Instagram's standard ~24h window,
// needs no special permission). If that's rejected — most commonly because
// the window closed — retries once with the HUMAN_AGENT message tag, which
// extends the window to 7 days. Every reply here genuinely is typed by a
// real staff member, never a bot, so the tag is honest — but Meta rejects it
// outright until the "Human Agent" App Review is approved (confirmed: it
// returns "your use of this endpoint must be reviewed and approved"), so the
// retry silently falls through to the original error until that happens.
// Once approved, the extended window starts working with no code change.
export async function sendInstagramMessage(
  igsid: string,
  text: string,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const plain = await attemptSend(igsid, text, false);
  if (plain.ok) return plain;

  const tagged = await attemptSend(igsid, text, true);
  return tagged.ok ? tagged : plain;
}

async function attemptSend(
  igsid: string,
  text: string,
  useHumanAgentTag: boolean,
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
          ...(useHumanAgentTag ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}),
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
