import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";

// Meta's delivery-status callback. Our own send call (src/lib/notifications.ts)
// only proves the Graph API accepted the request (status='sent') — this is
// the only source of truth for whether a WhatsApp message actually reached
// the device (delivered), was opened (read), or bounced (failed).

// One-time handshake Meta performs when the webhook URL is registered/saved
// in the App Dashboard's WhatsApp > Configuration screen.
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

interface WhatsappStatus {
  id: string;
  status: string; // "sent" | "delivered" | "read" | "failed"
  errors?: { code: number; title: string; error_data?: { details?: string } }[];
}
interface WhatsappWebhookPayload {
  entry?: { changes?: { value?: { statuses?: WhatsappStatus[] } }[] }[];
}

// Precedence so an out-of-order or duplicate callback never regresses a
// later status we already recorded (e.g. a delayed "sent" arriving after
// we've already marked the row "read").
const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

// Every branch below logs — this handler had zero observability before,
// which is exactly why "a WhatsApp message didn't arrive" was undebuggable
// from our own data: a signature failure (wrong/missing WHATSAPP_APP_SECRET,
// a proxy mangling the raw body, etc.) just returned 400 with no trace
// anywhere. These lines show up in `docker logs` / Coolify's log viewer.
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifySignature(raw, signature)) {
    console.error(
      `[webhook:whatsapp] signature verification failed — header ${
        signature ? `present (${signature.length} chars)` : "missing"
      }, body ${raw.length} bytes, secret ${config.notifications.whatsappAppSecret ? "configured" : "MISSING"}`,
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body: WhatsappWebhookPayload;
  try {
    body = JSON.parse(raw);
  } catch {
    console.error(`[webhook:whatsapp] invalid JSON payload (${raw.length} bytes)`);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const statuses =
    body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.statuses ?? []) ?? []) ?? [];
  console.log(`[webhook:whatsapp] received ${statuses.length} status update(s)`);

  await Promise.all(
    statuses.map(async (s) => {
      if (!(s.status in STATUS_RANK)) {
        console.log(`[webhook:whatsapp] ${s.id} -> untracked status "${s.status}", ignored`);
        return;
      }

      const { data: existing } = await admin
        .from("notifications")
        .select("id, status")
        .eq("provider_message_id", s.id)
        .maybeSingle();
      if (!existing) {
        console.log(`[webhook:whatsapp] ${s.id} -> no matching notification row, ignored`);
        return;
      }
      if (STATUS_RANK[s.status] <= STATUS_RANK[existing.status]) {
        console.log(
          `[webhook:whatsapp] ${s.id} -> ${s.status} is not newer than recorded ${existing.status}, ignored`,
        );
        return;
      }

      const error =
        s.status === "failed"
          ? (s.errors ?? [])
              .map((e) => `${e.code}: ${e.title}${e.error_data?.details ? ` — ${e.error_data.details}` : ""}`)
              .join("; ") || "WhatsApp delivery failed"
          : null;

      await admin.from("notifications").update({ status: s.status, error }).eq("id", existing.id);
      console.log(`[webhook:whatsapp] ${s.id} -> updated to ${s.status}${error ? ` (${error})` : ""}`);
    }),
  );

  // Meta requires 200 within a few seconds regardless of outcome, or it
  // retries with backoff and can eventually pause the subscription.
  return NextResponse.json({ ok: true });
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
