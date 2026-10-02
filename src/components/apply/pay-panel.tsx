"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import { mockCompletePayment, mockCompleteStudyMaterialPayment } from "@/app/apply/[token]/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/submit-button";
import { formatINR, cn } from "@/lib/utils";

interface RazorpayContext {
  razorpayEnabled: boolean;
  allowMockPayment: boolean;
  razorpayKeyId: string;
  parentName: string;
  parentEmail: string | null;
  parentPhone: string;
}

// Minimal shape of the global checkout.js exposes — not Razorpay's full SDK
// typings (they don't ship any), just what this file actually calls.
interface RazorpaySuccessResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayFailureResponse {
  error: { metadata?: { order_id?: string }; description?: string };
}
interface RazorpayCheckoutOptions {
  key: string;
  amount: string;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  handler: (response: RazorpaySuccessResponse) => void;
  modal: { ondismiss: () => void };
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", handler: (response: RazorpayFailureResponse) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
  }
}

const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

// Standard Checkout loads lazily — only once a parent actually clicks Pay —
// rather than on every visit to the apply page. Razorpay confirmed (support
// ticket #21209267) that the old Hosted Checkout integration (a full-page
// form POST to api.razorpay.com/v1/checkout/embedded) can never show a UPI
// QR code; Standard Checkout's overlay widget is the one that does, and is
// what the Dashboard's Payment Configuration (UPI QR/Apps/ID toggles)
// actually governs. The payment form itself still renders entirely inside
// Razorpay's own iframe — this page never touches a card number or UPI ID.
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Could not load the payment form.")));
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the payment form."));
    document.body.appendChild(script);
  });
}

async function payWithRazorpayCheckout(opts: {
  orderEndpoint: string;
  orderBody: Record<string, unknown>;
  token: string;
  description: string;
  ctx: RazorpayContext;
  onSettled: (error: string | null) => void;
}) {
  const res = await fetch(opts.orderEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.orderBody),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Could not start payment");
  const { orderId, amount, currency, keyId } = await res.json();

  await loadCheckoutScript();
  if (!window.Razorpay) throw new Error("Could not load the payment form.");

  const rzp = new window.Razorpay({
    key: keyId ?? opts.ctx.razorpayKeyId,
    amount: String(amount),
    currency,
    order_id: orderId,
    name: "Broadway Home Schooling",
    description: opts.description,
    prefill: {
      name: opts.ctx.parentName,
      email: opts.ctx.parentEmail ?? "",
      contact: opts.ctx.parentPhone.replace(/\D/g, ""),
    },
    theme: { color: "#1b7e9a" },
    handler: (response) => {
      fetch("/api/razorpay/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }),
      })
        .then((r) => {
          if (!r.ok) throw new Error();
          // Reload so the server component picks up the now-completed
          // payment and shows the next step — same end state the old
          // hosted-checkout callback redirect produced.
          window.location.reload();
        })
        .catch(() => {
          opts.onSettled(
            "Payment succeeded but we couldn't confirm it immediately. Refresh this page in a moment — if it still doesn't show, contact the school.",
          );
        });
    },
    modal: {
      ondismiss: () => opts.onSettled(null),
    },
  });

  rzp.on("payment.failed", (response) => {
    const orderIdFromError = response.error.metadata?.order_id ?? orderId;
    fetch("/api/razorpay/failed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: orderIdFromError, reason: response.error.description }),
    }).finally(() => {
      opts.onSettled("Payment did not complete. Please try again.");
    });
  });

  rzp.open();
}

// The main payment stage — two cards: Admission (required, locked) and Study
// material (optional, toggleable, only shown when a fee is configured for
// this grade). The total updates live as the parent toggles Study material.
export function PaymentSelector({
  token,
  admissionAmountPaise,
  studyMaterialAmountPaise,
  ...ctx
}: {
  token: string;
  admissionAmountPaise: number;
  studyMaterialAmountPaise: number;
} & RazorpayContext) {
  const [includeStudyMaterial, setIncludeStudyMaterial] = useState(studyMaterialAmountPaise > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = admissionAmountPaise + (includeStudyMaterial ? studyMaterialAmountPaise : 0);

  async function payWithRazorpay() {
    setBusy(true);
    setError(null);
    try {
      await payWithRazorpayCheckout({
        orderEndpoint: "/api/razorpay/order",
        orderBody: { token, includeStudyMaterial },
        token,
        description: includeStudyMaterial ? "Admission fee + Study material" : "Admission fee",
        ctx,
        onSettled: (err) => {
          setBusy(false);
          setError(err);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment error");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-primary bg-secondary/40 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Check className="size-3.5" />
            </span>
            <div>
              <div className="text-sm font-semibold">Admission payment</div>
              <div className="text-xs text-muted-foreground">Required to confirm the seat</div>
            </div>
          </div>
          <div className="whitespace-nowrap text-base font-semibold tabular-nums">
            {formatINR(admissionAmountPaise)}
          </div>
        </div>

        {studyMaterialAmountPaise > 0 && (
          <label
            className={cn(
              "flex cursor-pointer items-center justify-between gap-3 rounded-lg border-2 px-4 py-3.5 transition-colors",
              includeStudyMaterial ? "border-primary bg-secondary/40" : "border-border hover:border-primary/40",
            )}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={includeStudyMaterial}
                onChange={(e) => setIncludeStudyMaterial(e.target.checked)}
                className="size-5 shrink-0 rounded-md border-input accent-primary"
              />
              <div>
                <div className="text-sm font-semibold">Study material payment</div>
                <div className="text-xs text-muted-foreground">
                  Optional — you can also pay this later from your portal
                </div>
              </div>
            </div>
            <div className="whitespace-nowrap text-base font-semibold tabular-nums">
              {formatINR(studyMaterialAmountPaise)}
            </div>
          </label>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm font-medium text-muted-foreground">Total</span>
        <span className="font-display text-xl font-semibold tabular-nums">{formatINR(total)}</span>
      </div>

      {ctx.razorpayEnabled ? (
        <Button onClick={payWithRazorpay} disabled={busy} size="lg" className="w-full">
          {busy && <Loader2 className="animate-spin" />}
          Pay {formatINR(total)} with Razorpay
        </Button>
      ) : ctx.allowMockPayment ? (
        <form action={mockCompletePayment}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="include_study_material" value={includeStudyMaterial ? "on" : ""} />
          <Alert variant="info" className="mb-3">
            Razorpay keys are not configured, so this uses a simulated payment for
            local testing. In production the signature-verified webhook confirms
            payment.
          </Alert>
          <SubmitButton size="lg" variant="success" pendingText="Processing…" className="w-full">
            Simulate successful payment ({formatINR(total)})
          </SubmitButton>
        </form>
      ) : (
        <Alert variant="error">
          Online payment is temporarily unavailable. Please contact the school to
          complete your admission.
        </Alert>
      )}
    </div>
  );
}

// Standalone study-material payment, shown post-enrollment to a parent who
// declined it at the main payment step. A single item, so no toggle — just
// confirm and pay.
export function StudyMaterialPayPanel({
  token,
  amountPaise,
  ...ctx
}: {
  token: string;
  amountPaise: number;
} & RazorpayContext) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function payWithRazorpay() {
    setBusy(true);
    setError(null);
    try {
      await payWithRazorpayCheckout({
        orderEndpoint: "/api/razorpay/study-material-order",
        orderBody: { token },
        token,
        description: "Study material payment",
        ctx,
        onSettled: (err) => {
          setBusy(false);
          setError(err);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment error");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert variant="error">{error}</Alert>}

      {ctx.razorpayEnabled ? (
        <Button onClick={payWithRazorpay} disabled={busy} size="lg">
          {busy && <Loader2 className="animate-spin" />}
          Pay {formatINR(amountPaise)} with Razorpay
        </Button>
      ) : ctx.allowMockPayment ? (
        <form action={mockCompleteStudyMaterialPayment}>
          <input type="hidden" name="token" value={token} />
          <Alert variant="info" className="mb-3">
            Razorpay keys are not configured, so this uses a simulated payment for
            local testing.
          </Alert>
          <SubmitButton size="lg" variant="success" pendingText="Processing…">
            Simulate successful payment ({formatINR(amountPaise)})
          </SubmitButton>
        </form>
      ) : (
        <Alert variant="error">
          Online payment is temporarily unavailable. Please contact the school to pay.
        </Alert>
      )}
    </div>
  );
}
