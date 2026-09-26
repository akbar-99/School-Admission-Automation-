import { NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/lib/config";
import { handleInboundInstagramMessage } from "@/lib/workflow";

// Instagram DM enquiries, captured as unclaimed leads for any marketing team
// member to pick up (see handleInboundInstagramMessage in workflow.ts). This
// is a separate webhook object ("instagram") from the WhatsApp one
// (whatsapp_business_account) and uses the older Messenger-platform payload
// shape, but shares the same Meta App, so the same app secret and verify
// token apply here too.

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
  timestamp?: number;
  message?: { mid: string; text?: string; is_echo?: boolean };
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
    if (!event.message || event.message.is_echo) continue;
    // An emoji-only/no-real-words message (a stray 👍 or similar) isn't a
    // genuine enquiry signal — skip it. A real (even short) message like
    // "Hi" or "fees?" still passes, in any script.
    if (!hasRealText(event.message.text)) continue;
    const igsid = event.sender?.id;
    if (!igsid) continue;

    const profile = await fetchInstagramProfile(igsid);
    await handleInboundInstagramMessage(igsid, profile, event.message.text);
  }

  // Meta requires 200 within a few seconds regardless of outcome, or it
  // retries with backoff and can eventually pause the subscription.
  return NextResponse.json({ ok: true });
}

async function fetchInstagramProfile(igsid: string): Promise<{ name: string | null; username: string | null }> {
  if (!config.notifications.instagramToken) return { name: null, username: null };
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${igsid}?fields=name,username&access_token=${config.notifications.instagramToken}`,
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
  if (!config.notifications.whatsappAppSecret || !signature) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", config.notifications.whatsappAppSecret).update(rawBody).digest("hex");
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
