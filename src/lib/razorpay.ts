import "server-only";
import crypto from "node:crypto";
import { config } from "@/lib/config";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
  mock?: boolean;
}

// Create a Razorpay order SERVER-SIDE (SRS FR-17/FR-19). When keys are not
// configured (local dev) we return a mock order so the flow remains testable.
export async function createRazorpayOrder(params: {
  amount: number; // paise
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!config.razorpay.enabled) {
    return {
      id: `order_mock_${crypto.randomBytes(8).toString("hex")}`,
      amount: params.amount,
      currency: "INR",
      status: "created",
      receipt: params.receipt,
      mock: true,
    };
  }

  const auth = Buffer.from(
    `${config.razorpay.keyId}:${config.razorpay.keySecret}`,
  ).toString("base64");

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      currency: "INR",
      receipt: params.receipt,
      notes: params.notes ?? {},
      payment_capture: 1,
    }),
  });

  if (!res.ok) {
    throw new Error(`Razorpay order creation failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as RazorpayOrder;
  return data;
}

// Verify a Razorpay webhook signature using the webhook secret (SRS FR-20).
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
): boolean {
  if (!config.razorpay.webhookSecret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", config.razorpay.webhookSecret)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqual(expected, signature);
}

// Verify the checkout handler signature: HMAC(order_id|payment_id, key_secret).
export function verifyPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!config.razorpay.keySecret) return false;
  const expected = crypto
    .createHmac("sha256", config.razorpay.keySecret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest("hex");
  return timingSafeEqual(expected, params.signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
