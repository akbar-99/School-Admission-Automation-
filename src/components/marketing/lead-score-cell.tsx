"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  SCORE_QUESTIONS,
  TEMPERATURE_GUIDANCE,
  TEMPERATURE_LABEL,
  type Temperature,
} from "@/lib/lead-scoring";

const TONE: Record<Temperature, "danger" | "warning" | "info"> = {
  HOT: "danger",
  WARM: "warning",
  COLD: "info",
};

export function LeadScoreCell({
  action,
  applicationId,
  points,
  temperature,
  override,
  answers,
}: {
  action: (formData: FormData) => void;
  applicationId: string;
  points: number | null;
  temperature: Temperature | null;
  override: Temperature | null;
  answers: Record<string, string> | null;
}) {
  const [scoring, setScoring] = useState(false);
  const effective = override ?? temperature;

  if (!scoring) {
    return (
      <div className="space-y-1">
        {effective ? (
          <div className="space-y-0.5">
            <Badge tone={TONE[effective]}>
              {TEMPERATURE_LABEL[effective]}
              {override && override !== temperature ? " (overridden)" : ""}
            </Badge>
            {points != null && <div className="text-xs text-muted-foreground">{points} / 100 pts</div>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not scored yet</span>
        )}
        <button
          type="button"
          onClick={() => setScoring(true)}
          className="block text-xs text-primary underline-offset-2 hover:underline"
        >
          {effective ? "Update score" : "Score lead"}
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="w-72 space-y-2.5 rounded-md border border-border bg-card p-3">
      <input type="hidden" name="application_id" value={applicationId} />
      {SCORE_QUESTIONS.map((q) => (
        <div key={q.id} className="space-y-1">
          <Label htmlFor={`${applicationId}-${q.id}`} className="text-xs">
            {q.label}
          </Label>
          <Select
            id={`${applicationId}-${q.id}`}
            name={`answer_${q.id}`}
            defaultValue={answers?.[q.id] ?? ""}
            className="h-8 text-xs"
          >
            <option value="">Not asked yet</option>
            {q.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} ({o.points})
              </option>
            ))}
          </Select>
        </div>
      ))}
      <div className="space-y-1">
        <Label htmlFor={`${applicationId}-override`} className="text-xs">
          Override (optional — when you know something the score doesn&apos;t)
        </Label>
        <Select
          id={`${applicationId}-override`}
          name="override"
          defaultValue={override ?? ""}
          className="h-8 text-xs"
        >
          <option value="">Use computed result</option>
          <option value="HOT">Force Hot</option>
          <option value="WARM">Force Warm</option>
          <option value="COLD">Force Cold</option>
        </Select>
      </div>
      {effective && (
        <p className="rounded-md bg-secondary/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {TEMPERATURE_GUIDANCE[effective]}
        </p>
      )}
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" variant="outline" pendingText="Saving…">
          Save score
        </SubmitButton>
        <button
          type="button"
          onClick={() => setScoring(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
