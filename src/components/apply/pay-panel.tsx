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

// Razorpay's hosted checkout (a full-page redirect the browser POSTs to and
// pays on, required by the payment aggregator's compliance review) rather
// than the JS popup widget — no checkout.js to load, no in-page handler.
// Razorpay POSTs the result back to callback_url, which does the actual
// signature verification and crediting (see /api/razorpay/callback).
function submitToHostedCheckout(opts: {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  token: string;
  description: string;
  ctx: RazorpayContext;
}) {
  const origin = window.location.origin;
  const fields: Record<string, string> = {
    key_id: opts.keyId,
    amount: String(opts.amount),
    currency: opts.currency,
    order_id: opts.orderId,
    name: "Broadway Home Schooling",
    description: opts.description,
    "prefill[name]": opts.ctx.parentName,
    "prefill[email]": opts.ctx.parentEmail ?? "",
    "prefill[contact]": opts.ctx.parentPhone.replace(/\D/g, ""),
    "theme[color]": "#1b7e9a",
    callback_url: `${origin}/api/razorpay/callback?token=${encodeURIComponent(opts.token)}`,
    cancel_url: `${origin}/api/razorpay/cancel?token=${encodeURIComponent(opts.token)}`,
  };
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://api.razorpay.com/v1/checkout/embedded";
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

async function payWithHostedCheckout(opts: {
  orderEndpoint: string;
  orderBody: Record<string, unknown>;
  token: string;
  description: string;
  ctx: RazorpayContext;
}) {
  const res = await fetch(opts.orderEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.orderBody),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Could not start payment");
  const { orderId, amount, currency, keyId } = await res.json();
  // The browser navigates away here — nothing after this line runs.
  submitToHostedCheckout({
    orderId,
    amount,
    currency,
    keyId: keyId ?? opts.ctx.razorpayKeyId,
    token: opts.token,
    description: opts.description,
    ctx: opts.ctx,
  });
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
      await payWithHostedCheckout({
        orderEndpoint: "/api/razorpay/order",
        orderBody: { token, includeStudyMaterial },
        token,
        description: includeStudyMaterial ? "Admission fee + Study material" : "Admission fee",
        ctx,
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
      await payWithHostedCheckout({
        orderEndpoint: "/api/razorpay/study-material-order",
        orderBody: { token },
        token,
        description: "Study material payment",
        ctx,
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
