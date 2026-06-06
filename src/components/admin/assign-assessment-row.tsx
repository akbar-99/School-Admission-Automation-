"use client";

import { useState } from "react";
import { assignAssessment } from "@/app/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface Teacher {
  id: string;
  label: string;
}

interface PreferredTime {
  /** Display string, e.g. "6 Jun 2026, 4:19 pm IST". */
  label: string;
  /** datetime-local value in the school timezone, e.g. "2026-06-06T16:19". */
  value: string;
}

export interface AssignAssessmentRowProps {
  applicationId: string;
  studentName: string;
  grade: string | null;
  phone: string | null;
  /** Primary requested time (and optional alternate), pre-computed server-side. */
  preferred: PreferredTime | null;
  preferredAlt: PreferredTime | null;
  /** Parent's own-timezone display line, shown only when it differs from school. */
  parentLabel: string | null;
  teachers: Teacher[];
}

export function AssignAssessmentRow({
  applicationId,
  studentName,
  grade,
  phone,
  preferred,
  preferredAlt,
  parentLabel,
  teachers,
}: AssignAssessmentRowProps) {
  const [value, setValue] = useState("");

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
        <div>
          <span className="font-medium">{studentName}</span>
          <span className="text-muted-foreground"> · Grade {grade}</span>
          {phone && (
            <a href={`tel:${phone}`} className="ml-2 text-primary hover:underline">
              {phone}
            </a>
          )}
        </div>
        <div className="text-right text-xs">
          {preferred ? (
            <>
              <button
                type="button"
                onClick={() => setValue(preferred.value)}
                title="Click to use this time"
                className="rounded-md px-2 py-1 text-right transition-colors hover:bg-secondary"
              >
                <span className="font-medium text-primary hover:underline">
                  Requested: {preferred.label}
                </span>
                <span className="ml-1 text-[11px] text-muted-foreground">(use)</span>
              </button>
              {parentLabel && <div className="px-2 text-muted-foreground">Parent: {parentLabel}</div>}
              {preferredAlt && (
                <button
                  type="button"
                  onClick={() => setValue(preferredAlt.value)}
                  title="Click to use the alternate time"
                  className="rounded-md px-2 py-0.5 text-right text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
                >
                  Alt: {preferredAlt.label} <span className="text-[11px]">(use)</span>
                </button>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">No preferred time</span>
          )}
        </div>
      </div>

      {teachers.length > 0 && (
        <form action={assignAssessment} className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-2">
          <input type="hidden" name="application_id" value={applicationId} />
          <div className="space-y-1">
            <Label htmlFor={`time-${applicationId}`} className="text-xs">
              Confirmed time (school time)
            </Label>
            <Input
              id={`time-${applicationId}`}
              name="starts_at"
              type="datetime-local"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`dur-${applicationId}`} className="text-xs">
              Min
            </Label>
            <Input
              id={`dur-${applicationId}`}
              name="duration"
              type="number"
              min={10}
              max={240}
              defaultValue={30}
              className="h-9 w-20"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`teach-${applicationId}`} className="text-xs">
              Teacher
            </Label>
            <Select id={`teach-${applicationId}`} name="teacher_id" required defaultValue="" className="h-9 min-w-36">
              <option value="" disabled>
                Select…
              </option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <SubmitButton size="sm" pendingText="Scheduling…">
            Schedule directly
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
