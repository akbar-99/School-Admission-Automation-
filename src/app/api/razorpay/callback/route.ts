import { NextRequest, NextResponse } from "next/server";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { markPaymentCompleted, markPaymentFailed } from "@/lib/payments";
import { config } from "@/lib/config";

// Where Razorpay's hosted checkout POSTs the result back to (required by the
// payment aggregator's compliance review — replaces the old JS-popup +
// client-side "handler" callback flow). The browser fully navigates away to
// Razorpay's own page to pay, then Razorpay redirects it here with the
// result as form fields, and we redirect it on to the parent's own portal
// page. `token` travels in the callback_url's query string (set when the
// order was created) since Razorpay's payload has no room for app-specific
// context beyond its own order/payment IDs.
function redirectTo(origin: string, token: string, error?: string): NextResponse {
  const url = new URL(`/apply/${token}`, origin);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

// Razorpay's documented shape for a failed-payment POST-back: no
// razorpay_signature, but error metadata carrying the order id instead.
function failedOrderId(form: FormData): string {
  const direct = form.get("error[metadata][order_id]");
  if (typeof direct === "string" && direct) return direct;
  const meta = form.get("error[metadata]");
  if (typeof meta === "string" && meta) {
    try {
      const parsed = JSON.parse(meta);
      if (parsed?.order_id) return parsed.order_id;
    } catch {
      // fall through
    }
  }
  const rzp = form.get("razorpay_order_id");
  return typeof rzp === "string" ? rzp : "";
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  // Deliberately NOT url.origin: behind a self-hosted reverse proxy (Coolify/
  // Traefik), the Host header Next.js sees on the incoming request can be the
  // container's internal address rather than the public domain, sending the
  // parent's browser to e.g. http://localhost:3000 after a real payment on
  // the real domain. config.appUrl is the app's one trusted canonical origin,
  // already used for every other parent-facing link (admission link,
  // agreement, receipt) — use it here too instead of trusting the proxy.
  const origin = config.appUrl;
  const token = url.searchParams.get("token") ?? "";
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirectTo(origin, token, "Payment callback was malformed. Please try again.");
  }

  const orderId = String(form.get("razorpay_order_id") ?? "");
  const paymentId = String(form.get("razorpay_payment_id") ?? "");
  const signature = String(form.get("razorpay_signature") ?? "");

  if (!signature) {
    const failedOrder = failedOrderId(form);
    if (failedOrder) {
      await markPaymentFailed(failedOrder, "Hosted checkout returned without a signature");
    }
    return redirectTo(origin, token, "Payment did not complete. Please try again.");
  }

  const valid = verifyPaymentSignature({ orderId, paymentId, signature });
  if (!valid) {
    // Never mark a payment completed on an unverified signature — this is
    // the actual proof of payment, same standard as the webhook path.
    return redirectTo(origin, token, "Payment verification failed. Please contact the school if you were charged.");
  }

  const result = await markPaymentCompleted({ orderId, paymentId, signature });
  if (!result.ok && result.reason === "db_error") {
    // The webhook (authoritative, independent of the browser) will retry
    // this same completion shortly — send the parent back without alarming
    // them over what's likely a transient error.
    return redirectTo(origin, token);
  }
  return redirectTo(origin, token);
}

// Razorpay can also land the browser here via GET in some flows — just get
// the parent back to their own portal page rather than showing a raw error.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  return redirectTo(config.appUrl, token);
}
