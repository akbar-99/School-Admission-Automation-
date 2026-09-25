import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import type { NotificationChannel } from "@/lib/types";

// SRS §2.1: all providers sit behind a single NotificationService interface so
// they can be swapped; development uses a mock/log provider.

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface OutboundMessage {
  applicationId?: string | null;
  event: string; // N-1 .. N-10
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  body: string;
  payload?: Record<string, unknown>;
  attachments?: EmailAttachment[]; // email-only; ignored by SMS/WhatsApp
  // WhatsApp-only: when set and the channel is "whatsapp", send an approved
  // template message (works outside the 24h session window) instead of the
  // freeform `body` text (which only delivers if the recipient messaged
  // first within the last 24 hours). Ignored by every other channel.
  whatsappTemplate?: { name: string; params: string[] };
}

interface NotificationProvider {
  // Returns Meta's WhatsApp message id when the channel is whatsapp (so the
  // delivery-status webhook can later match a status callback back to this
  // row); undefined for every other channel.
  send(msg: OutboundMessage): Promise<string | undefined>;
}

// Dev default: log to console (provider is a no-op transport).
class LogProvider implements NotificationProvider {
  async send(msg: OutboundMessage): Promise<string | undefined> {
    console.log(
      `[notify:${msg.channel}] ${msg.event} -> ${msg.recipient}` +
        (msg.subject ? ` | ${msg.subject}` : "") +
        `\n  ${msg.body.replace(/\n/g, "\n  ")}`,
    );
    return undefined;
  }
}

// SMTP transport (e.g. Hostinger), created lazily and reused across sends.
let mailer: Transporter | null = null;
function smtpTransport(): Transporter {
  if (!mailer) {
    const { host, port, user, pass } = config.notifications.smtp;
    mailer = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // implicit TLS on 465; STARTTLS on 587
      auth: { user, pass },
    });
  }
  return mailer;
}

// Live provider: routes per channel to SMTP / Resend / MSG91 / WhatsApp.
// A configured channel that fails THROWS (so dispatch records it as `failed`);
// an unconfigured channel degrades to the log provider (recorded as `sent`).
class LiveProvider implements NotificationProvider {
  private fallback = new LogProvider();

  async send(msg: OutboundMessage): Promise<string | undefined> {
    if (msg.channel === "email") {
      const smtp = config.notifications.smtp;
      if (smtp.enabled) {
        await smtpTransport().sendMail({
          from: smtp.from,
          to: msg.recipient,
          subject: msg.subject ?? "School Admissions",
          text: msg.body,
          attachments: msg.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        });
        return undefined;
      }
      if (config.notifications.resendApiKey) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.notifications.resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: smtp.from || "Admissions <onboarding@resend.dev>",
            to: [msg.recipient],
            subject: msg.subject ?? "School Admissions",
            text: msg.body,
            ...(msg.attachments?.length
              ? {
                  attachments: msg.attachments.map((a) => ({
                    filename: a.filename,
                    content: a.content.toString("base64"),
                  })),
                }
              : {}),
          }),
        });
        if (!res.ok) {
          throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
        }
        return undefined;
      }
    } else if (msg.channel === "whatsapp" && config.notifications.whatsappToken) {
      const payload = msg.whatsappTemplate
        ? {
            messaging_product: "whatsapp",
            to: msg.recipient,
            type: "template",
            template: {
              name: msg.whatsappTemplate.name,
              language: { code: "en_US" },
              components: [
                {
                  type: "body",
                  parameters: msg.whatsappTemplate.params.map((text) => ({ type: "text", text })),
                },
              ],
            },
          }
        : {
            messaging_product: "whatsapp",
            to: msg.recipient,
            type: "text",
            text: { body: msg.body },
          };
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${config.notifications.whatsappPhoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.notifications.whatsappToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        throw new Error(`WhatsApp failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { messages?: { id?: string }[] };
      return json.messages?.[0]?.id;
    }
    // SMS (MSG91) and any unconfigured channel -> log fallback.
    return this.fallback.send(msg);
  }
}

function provider(): NotificationProvider {
  return config.notifications.provider === "live"
    ? new LiveProvider()
    : new LogProvider();
}

// Send a batch, recording every message in the notifications table with its
// delivery status (SRS §3.7).
export async function dispatch(messages: OutboundMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const admin = createSupabaseAdminClient();
  const p = provider();

  await Promise.all(
    messages.map(async (msg) => {
      let status: "sent" | "failed" = "sent";
      let error: string | null = null;
      let providerMessageId: string | undefined;
      try {
        providerMessageId = await p.send(msg);
      } catch (err) {
        status = "failed";
        error = err instanceof Error ? err.message : String(err);
      }
      await admin.from("notifications").insert({
        application_id: msg.applicationId ?? null,
        event: msg.event,
        channel: msg.channel,
        recipient: msg.recipient,
        subject: msg.subject ?? null,
        body: msg.body,
        payload: msg.payload ?? null,
        status,
        error,
        provider_message_id: providerMessageId ?? null,
      });
    }),
  );
}

// Convenience: fan one message out across multiple channels to one recipient
// contact set.
export function multiChannel(
  base: Omit<OutboundMessage, "channel" | "recipient">,
  contacts: { email?: string | null; phone?: string | null },
  channels: NotificationChannel[] = ["email", "sms", "whatsapp"],
): OutboundMessage[] {
  const out: OutboundMessage[] = [];
  for (const channel of channels) {
    const recipient =
      channel === "email" ? contacts.email : contacts.phone;
    if (recipient) out.push({ ...base, channel, recipient });
  }
  return out;
}
