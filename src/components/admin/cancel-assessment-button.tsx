"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

// Silent, no-undo action (no message goes to the parent/teacher) — a plain
// window.confirm() is too easy to click through without reading. Matches the
// "type DELETE to confirm" pattern already used for the applicant-delete
// danger zone (src/app/admin/applications/[id]/page.tsx), just collapsed
// into a reveal so it doesn't take up space on every row until needed.
export function CancelAssessmentButton({
  action,
  applicationId,
}: {
  action: (formData: FormData) => void;
  applicationId: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
      >
        Cancel
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="application_id" value={applicationId} />
      <Input
        name="confirm"
        required
        pattern="CANCEL"
        title='Type CANCEL to confirm'
        placeholder="CANCEL"
        autoComplete="off"
        autoFocus
        className="h-8 w-24 text-xs"
      />
      <SubmitButton size="sm" variant="destructive" pendingText="Cancelling…">
        Confirm
      </SubmitButton>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Back
      </button>
    </form>
  );
}
