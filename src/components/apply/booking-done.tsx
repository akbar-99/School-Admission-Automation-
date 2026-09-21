"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

// Purely a closing acknowledgment for the parent after booking a slot — no
// server state involved (nothing downstream depends on whether they clicked
// it), so this is deliberately local-only rather than persisted.
export function BookingDone() {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Alert variant="success">
        Thank you — your assessment is all set. We look forward to meeting you soon.
        You&apos;ll get a reminder as the date approaches.
      </Alert>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={() => setDone(true)}>
      <Check className="size-4" />
      Done
    </Button>
  );
}
