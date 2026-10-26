"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Textarea } from "@/components/ui/textarea";

// Internal marketing note on a lead — collapsed to plain text by default so
// it doesn't bloat every row of a dense table; "Edit" reveals a small
// textarea + Save, mirroring the reveal pattern already used for "Already
// assessed outside the app?" (assign-assessment-row.tsx).
export function LeadRemarksCell({
  action,
  applicationId,
  initialRemarks,
}: {
  action: (formData: FormData) => void;
  applicationId: string;
  initialRemarks: string | null;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="max-w-[220px] space-y-1">
        {initialRemarks ? (
          <p className="whitespace-pre-wrap text-xs text-foreground">{initialRemarks}</p>
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          {initialRemarks ? "Edit" : "Add remark"}
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="w-56 space-y-1.5">
      <input type="hidden" name="application_id" value={applicationId} />
      <Textarea
        name="marketing_remarks"
        defaultValue={initialRemarks ?? ""}
        placeholder="Internal note for marketing only…"
        className="h-16 text-xs"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" variant="outline" pendingText="Saving…">
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
