"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { scoreEntriesFromForm, subjectsMissingScores } from "@/lib/result-scores";

// "Record result" that stays disabled until every subject in its own form
// has a score (0 up to its maximum). Reads the form's existing fields, so
// the server-rendered form itself doesn't change; submitResult enforces the
// same rule (src/lib/result-scores.ts) in case this is bypassed.
export function RecordResultButton() {
  const ref = useRef<HTMLDivElement>(null);
  // null until checked in the browser — disabled on the server render too.
  const [missing, setMissing] = useState<string[] | null>(null);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const check = () => {
      const entries = scoreEntriesFromForm((name) => {
        const el = form.elements.namedItem(name);
        return el instanceof HTMLInputElement ? el.value : null;
      });
      setMissing(subjectsMissingScores(entries));
    };
    check();
    form.addEventListener("input", check);
    return () => form.removeEventListener("input", check);
  }, []);

  const blocked = missing === null || missing.length > 0;
  return (
    <div ref={ref} className="space-y-1">
      <SubmitButton size="sm" pendingText="Saving…" disabled={blocked}>
        Record result
      </SubmitButton>
      {missing && missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Enter a score for {missing.join(", ")} to record the result.
        </p>
      )}
    </div>
  );
}
