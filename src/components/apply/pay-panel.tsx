"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import { mockCompletePayment, mockCompleteStudyMaterialPayment } from "@/app/apply/[token]/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/submit-button";
import { formatINR, cn } from "@/lib/utils";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

interface RazorpayContext {
  razorpayEnabled: boolean;
  allowMockPayment: boolean;
  razorpayKeyId: string;
  parentName: string;
  parentEmail: string | null;
  parentPhone: string;
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.body.appendChild(script);
  });
}

async function openRazorpay(opts: {
  orderEndpoint: string;
  orderBody: Record<string, unknown>;
  amountLabel: string;
  ctx: RazorpayContext;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const res = await fetch(opts.orderEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.orderBody),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Could not start payment");
  const { orderId, amount, keyId } = await res.json();

  await loadRazorpayScript();
  if (!window.Razorpay) throw new Error("Razorpay failed to load");

  const rzp = new window.Razorpay({
    key: keyId ?? opts.ctx.razorpayKeyId,
    order_id: orderId,
    amount,
    currency: "INR",
    name: "Broadway Home Schooling",
    description: opts.amountLabel,
    prefill: { name: opts.ctx.parentName, email: opts.ctx.parentEmail ?? "", contact: opts.ctx.parentPhone },
    handler: async (response: Record<string, string>) => {
      await fetch("/api/razorpay/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: opts.orderBody.token,
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }),
      });
      window.location.reload();
    },
    modal: { ondismiss: opts.onDone },
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
      await openRazorpay({
        orderEndpoint: "/api/razorpay/order",
        orderBody: { token, includeStudyMaterial },
        amountLabel: includeStudyMaterial ? "Admission fee + Study material" : "Admission fee",
        ctx,
        onError: setError,
        onDone: () => setBusy(false),
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
      await openRazorpay({
        orderEndpoint: "/api/razorpay/study-material-order",
        orderBody: { token },
        amountLabel: "Study material payment",
        ctx,
        onError: setError,
        onDone: () => setBusy(false),
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
