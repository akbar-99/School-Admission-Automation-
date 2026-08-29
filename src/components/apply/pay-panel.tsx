"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { mockCompletePayment } from "@/app/apply/[token]/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/submit-button";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export function PayPanel({
  token,
  amountLabel,
  razorpayEnabled,
  allowMockPayment,
  razorpayKeyId,
  parentName,
  parentEmail,
  parentPhone,
}: {
  token: string;
  amountLabel: string;
  razorpayEnabled: boolean;
  allowMockPayment: boolean;
  razorpayKeyId: string;
  parentName: string;
  parentEmail: string | null;
  parentPhone: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function payWithRazorpay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not start payment");
      const { orderId, amount, keyId } = await res.json();

      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error("Razorpay failed to load");

      const rzp = new window.Razorpay({
        key: keyId ?? razorpayKeyId,
        order_id: orderId,
        amount,
        currency: "INR",
        name: "School Admission Fee",
        prefill: { name: parentName, email: parentEmail ?? "", contact: parentPhone },
        handler: async (response: Record<string, string>) => {
          await fetch("/api/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            }),
          });
          window.location.reload();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment error");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert variant="error">{error}</Alert>}

      {razorpayEnabled ? (
        <Button onClick={payWithRazorpay} disabled={busy} size="lg">
          {busy && <Loader2 className="animate-spin" />}
          Pay {amountLabel} with Razorpay
        </Button>
      ) : allowMockPayment ? (
        <form action={mockCompletePayment}>
          <input type="hidden" name="token" value={token} />
          <Alert variant="info" className="mb-3">
            Razorpay keys are not configured, so this uses a simulated payment for
            local testing. In production the signature-verified webhook confirms
            payment.
          </Alert>
          <SubmitButton size="lg" variant="success" pendingText="Processing…">
            Simulate successful payment ({amountLabel})
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
