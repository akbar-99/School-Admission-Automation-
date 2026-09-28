"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

// The parent's single closing step once there's nothing left for them to do:
// "Done" opens a short thank-you popup they can dismiss, then leaves a calm
// "all set" line behind. Purely local — nothing downstream depends on
// whether they clicked it, so it isn't persisted. Uses the native <dialog>
// so focus-trapping, Esc-to-close and the backdrop come for free (including
// on mobile Safari). We deliberately don't try window.close(): browsers
// block it for a tab the page didn't open itself.
export function BookingDone() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [finished, setFinished] = useState(false);

  if (finished) {
    return (
      <p className="flex items-start gap-2 text-sm font-medium text-success">
        <Check className="mt-0.5 size-4 shrink-0" />
        All set — you can close this page and wait for your assessment.
      </p>
    );
  }

  return (
    <>
      <Button className="w-full sm:w-auto" onClick={() => dialogRef.current?.showModal()}>
        <Check className="size-4" />
        Done
      </Button>

      <dialog
        ref={dialogRef}
        onClose={() => setFinished(true)}
        onClick={(e) => {
          // Only a click on the backdrop itself lands on the <dialog>
          // element — clicks inside hit the inner content instead.
          if (e.target === e.currentTarget) dialogRef.current?.close();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-card p-0 text-foreground shadow-luxe backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      >
        <div className="space-y-4 p-6 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
            <Check className="size-6" />
          </div>
          <h2 className="font-display text-2xl font-semibold">You&apos;re all set!</h2>
          <p className="text-sm text-muted-foreground">
            Thank you — your assessment is all set. We look forward to meeting you soon. You&apos;ll get a
            reminder as the date approaches.
          </p>
          <p className="text-sm font-medium">You can close this window now and wait for your assessment.</p>
          <Button className="w-full" autoFocus onClick={() => dialogRef.current?.close()}>
            Close
          </Button>
        </div>
      </dialog>
    </>
  );
}
