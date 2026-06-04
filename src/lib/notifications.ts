import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import type { NotificationChannel } from "@/lib/types";

// SRS §2.1: all providers sit behind a single NotificationService interface so
// they can be swapped; development uses a mock/log provider.

export interface OutboundMessage {
  applicationId?: string | null;
  event: string; // N-1 .. N-10
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  body: string;
  payload?: Record<string, unknown>;
}

interface NotificationProvider {
  send(msg: OutboundMessage): Promise<void>;
}

// Dev default: log to console (provider is a no-op transport).
class LogProvider implements NotificationProvider {
  async send(msg: OutboundMessage): Promise<void> {
    console.log(
      `[notify:${msg.channel}] ${msg.event} -> ${msg.recipient}` +
        (msg.subject ? ` | ${msg.subject}` : "") +
        `\n  ${msg.body.replace(/\n/g, "\n  ")}`,
    );
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

  async send(msg: OutboundMessage): Promise<void> {
    if (msg.channel === "email") {
      const smtp = config.notifications.smtp;
      if (smtp.enabled) {
        await smtpTransport().sendMail({
          from: smtp.from,
          to: msg.recipient,
          subject: msg.subject ?? "School Admissions",
          text: msg.body,
        });
        return;
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
          }),
        });
        if (!res.ok) {
          throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
        }
        return;
      }
    } else if (msg.channel === "whatsapp" && config.notifications.whatsappToken) {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${config.notifications.whatsappPhoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.notifications.whatsappToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: msg.recipient,
            type: "text",
            text: { body: msg.body },
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`WhatsApp failed: ${res.status} ${await res.text()}`);
      }
      return;
    }
    // SMS (MSG91) and any unconfigured channel -> log fallback.
    await this.fallback.send(msg);
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
      try {
        await p.send(msg);
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
