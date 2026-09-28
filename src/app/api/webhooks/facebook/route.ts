import { NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/lib/config";
import { handleInboundFacebookMessage, recordFacebookEcho } from "@/lib/workflow";

// Facebook Page Messenger DM enquiries, captured as unclaimed leads exactly
// like Instagram's (see src/app/api/webhooks/instagram/route.ts, which this
// mirrors closely). Same underlying Messenger Platform payload shape, but a
// separate webhook object ("page", not "instagram") and its own Page Access
// Token / App Secret.

// One-time handshake Meta performs when the webhook URL is registered/saved.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    config.notifications.whatsappWebhookVerifyToken &&
    timingSafeEqual(token, config.notifications.whatsappWebhookVerifyToken)
  ) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

interface FacebookMessagingEvent {
  sender: { id: string }; // PSID
  recipient?: { id: string }; // for an echo: the customer's PSID
  timestamp?: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: { type?: string }[];
  };
}
interface FacebookWebhookPayload {
  object?: string;
  entry?: { id: string; messaging?: FacebookMessagingEvent[] }[];
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifySignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body: FacebookWebhookPayload;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const events = body.entry?.flatMap((e) => e.messaging ?? []) ?? [];

  for (const event of events) {
    if (!event.message) continue;
    // An echo is a message this Page itself sent — typically staff replying
    // from the native Facebook/Messenger app. Record it in the thread,
    // never treat it as a new enquiry.
    if (event.message.is_echo) {
      const to = event.recipient?.id;
      const echoText =
        event.message.text?.trim() || (event.message.attachments?.length ? "(attachment)" : "");
      if (to && echoText) await recordFacebookEcho(to, event.message.mid ?? null, echoText);
      continue;
    }
    const hasAttachment = Boolean(event.message.attachments?.length);
    if (!hasAttachment && !hasRealText(event.message.text)) continue;
    const psid = event.sender?.id;
    if (!psid) continue;

    const profile = await fetchFacebookProfile(psid);
    const messageText = event.message.text?.trim() || (hasAttachment ? "Sent an attachment via Facebook" : null);
    await handleInboundFacebookMessage(psid, profile, messageText);
  }

  // Meta requires 200 within a few seconds regardless of outcome, or it
  // retries with backoff and can eventually pause the subscription.
  return NextResponse.json({ ok: true });
}

async function fetchFacebookProfile(psid: string): Promise<{ name: string | null; username: string | null }> {
  if (!config.notifications.facebookPageToken) return { name: null, username: null };
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(config.notifications.facebookPageToken)}`,
    );
    if (!res.ok) return { name: null, username: null };
    const json = (await res.json()) as { first_name?: string; last_name?: string };
    const name = [json.first_name, json.last_name].filter(Boolean).join(" ").trim() || null;
    return { name, username: null };
  } catch (err) {
    console.error("[webhooks/facebook] profile lookup failed", err);
    return { name: null, username: null };
  }
}

// At least one real letter or digit, in any script — excludes emoji-only,
// punctuation-only, or empty messages, without penalizing short-but-genuine
// ones like "Hi" or non-English enquiries.
function hasRealText(text: string | undefined): boolean {
  return Boolean(text && /[\p{L}\p{N}]/u.test(text));
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!config.notifications.facebookAppSecret || !signature) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", config.notifications.facebookAppSecret).update(rawBody).digest("hex");
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
