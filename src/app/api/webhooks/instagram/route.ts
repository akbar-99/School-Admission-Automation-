import { NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/lib/config";
import { handleInboundInstagramMessage, recordInstagramEcho } from "@/lib/workflow";

// Instagram DM enquiries, captured as unclaimed leads for any marketing team
// member to pick up (see handleInboundInstagramMessage in workflow.ts). This
// is a separate webhook object ("instagram") from the WhatsApp one
// (whatsapp_business_account) and uses the older Messenger-platform payload
// shape. It lives under the same "Broadway Admissions" developer app as
// WhatsApp, so the verify token is shared — but Instagram has its own
// sub-app identity with its own App Secret, so signatures are verified
// against INSTAGRAM_APP_SECRET, not the WhatsApp one.

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

interface InstagramMessagingEvent {
  sender: { id: string }; // IGSID
  recipient?: { id: string }; // for an echo: the customer's IGSID
  timestamp?: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    // Present (with no usable text) for structured interactions like the
    // native "Enquire" appointment-request button — Meta doesn't expose the
    // actual request details (preferred time, message) through this field.
    attachments?: { type?: string }[];
  };
}
interface InstagramWebhookPayload {
  object?: string;
  entry?: { id: string; messaging?: InstagramMessagingEvent[] }[];
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifySignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body: InstagramWebhookPayload;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const events = body.entry?.flatMap((e) => e.messaging ?? []) ?? [];

  for (const event of events) {
    // is_echo marks a message this business account itself sent (e.g. a
    // rep replying from the native Instagram app) — never a new enquiry. A
    // "like"/heart-react on a message has no `message` field at all (it's a
    // separate reaction event), so it's already excluded here too.
    if (!event.message) continue;
    // An echo is a message this account itself sent — typically staff
    // replying in the native Instagram app. Record it in the thread, never
    // treat it as a new enquiry.
    if (event.message.is_echo) {
      const to = event.recipient?.id;
      const echoText =
        event.message.text?.trim() || (event.message.attachments?.length ? "(attachment)" : "");
      if (to && echoText) await recordInstagramEcho(to, event.message.mid ?? null, echoText);
      continue;
    }
    const hasAttachment = Boolean(event.message.attachments?.length);
    // An emoji-only/no-real-words plain message (a stray 👍 or similar) isn't
    // a genuine enquiry signal — skip it. A structured interaction (e.g. the
    // native "Enquire" appointment-request button) has no usable text at
    // all but IS a genuine signal, so it still counts.
    if (!hasAttachment && !hasRealText(event.message.text)) continue;
    const igsid = event.sender?.id;
    if (!igsid) continue;

    const profile = await fetchInstagramProfile(igsid);
    const messageText = event.message.text?.trim() || (hasAttachment ? "Requested an appointment via Instagram" : null);
    await handleInboundInstagramMessage(igsid, profile, messageText);
  }

  // Meta requires 200 within a few seconds regardless of outcome, or it
  // retries with backoff and can eventually pause the subscription.
  return NextResponse.json({ ok: true });
}

async function fetchInstagramProfile(igsid: string): Promise<{ name: string | null; username: string | null }> {
  if (!config.notifications.instagramToken) return { name: null, username: null };
  try {
    const res = await fetch(
      `https://graph.instagram.com/v20.0/${igsid}?fields=name,username&access_token=${encodeURIComponent(config.notifications.instagramToken)}`,
    );
    if (!res.ok) return { name: null, username: null };
    const json = (await res.json()) as { name?: string; username?: string };
    return { name: json.name ?? null, username: json.username ?? null };
  } catch (err) {
    console.error("[webhooks/instagram] profile lookup failed", err);
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
  if (!config.notifications.instagramAppSecret || !signature) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", config.notifications.instagramAppSecret).update(rawBody).digest("hex");
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
