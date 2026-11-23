"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { describeClass, resolveCurriculum, type ClassChoice, type Curriculum } from "@/lib/class-change";

const KG = /^\s*kg\s*\d+\s*$/i;

// "Change class" for an assessed applicant who hasn't paid yet: pick the
// other curriculum, one class up, or any class; confirm; start_class_change
// does the rest (see src/app/admin/actions.ts startClassChange).
export function ClassChangePanel({
  applicationId,
  current,
  otherCurriculum,
  oneClassUp,
  classes,
  needsAssessmentFor,
  action,
}: {
  applicationId: string;
  current: ClassChoice;
  otherCurriculum: ClassChoice | null;
  oneClassUp: ClassChoice | null;
  classes: string[];
  // Classes that need no assessment (only KG 1) — passed in so the rule stays in lib/assessment.ts.
  needsAssessmentFor: Record<string, boolean>;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [grade, setGrade] = useState("");
  const [kgCurriculum, setKgCurriculum] = useState<Curriculum | "">(current.curriculum ?? "");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  const isKg = KG.test(grade);
  const curriculum = grade ? resolveCurriculum(grade, kgCurriculum || null) : null;
  const target: ClassChoice | null = grade && curriculum ? { grade, curriculum } : null;
  const sameAsNow =
    target !== null &&
    target.grade.replace(/\s+/g, "").toLowerCase() === current.grade.replace(/\s+/g, "").toLowerCase() &&
    target.curriculum === current.curriculum;
  const needsAssessment = target ? (needsAssessmentFor[target.grade] ?? true) : true;

  function pick(choice: ClassChoice) {
    setGrade(choice.grade);
    if (choice.curriculum) setKgCurriculum(choice.curriculum);
    setConfirming(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {otherCurriculum && (
          <Button type="button" variant="outline" size="sm" onClick={() => pick(otherCurriculum)}>
            Other curriculum: {describeClass(otherCurriculum)}
          </Button>
        )}
        {oneClassUp && (
          <Button type="button" variant="outline" size="sm" onClick={() => pick(oneClassUp)}>
            One class up: {describeClass(oneClassUp)}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="change_to_grade" className="text-xs">
            New class
          </Label>
          <Select
            id="change_to_grade"
            value={grade}
            onChange={(e) => {
              setGrade(e.target.value);
              setConfirming(false);
            }}
            className="h-9 w-40 py-1 text-sm"
          >
            <option value="">Choose…</option>
            {classes.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </div>
        {isKg && (
          <div className="space-y-1">
            <Label htmlFor="change_kg_curriculum" className="text-xs">
              Curriculum
            </Label>
            <Select
              id="change_kg_curriculum"
              value={kgCurriculum}
              onChange={(e) => {
                setKgCurriculum(e.target.value as Curriculum | "");
                setConfirming(false);
              }}
              className="h-9 w-36 py-1 text-sm"
            >
              <option value="">Choose…</option>
              <option value="CBSE">CBSE</option>
              <option value="Cambridge">Cambridge</option>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="change_reason" className="text-xs">
            Reason (optional)
          </Label>
          <Input
            id="change_reason"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. parent prefers Cambridge"
            className="h-9 w-64"
          />
        </div>
        {!confirming && (
          <Button
            type="button"
            size="sm"
            disabled={!target || sameAsNow}
            onClick={() => setConfirming(true)}
          >
            Change class…
          </Button>
        )}
      </div>
      {sameAsNow && (
        <p className="text-xs text-muted-foreground">That&apos;s the class the applicant already has.</p>
      )}
      {isKg && !kgCurriculum && <p className="text-xs text-muted-foreground">Pick the curriculum for the KG class.</p>}

      {confirming && target && !sameAsNow && (
        <form action={action} className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
          <input type="hidden" name="application_id" value={applicationId} />
          <input type="hidden" name="to_grade" value={target.grade} />
          <input type="hidden" name="kg_curriculum" value={isKg ? (target.curriculum ?? "") : ""} />
          <input type="hidden" name="reason" value={reason} />
          <p className="text-sm">
            Change from <span className="font-medium">{describeClass(current)}</span> to{" "}
            <span className="font-medium">{describeClass(target)}</span>?
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>The parent&apos;s details stay — they don&apos;t fill anything in again.</li>
            {needsAssessment ? (
              <>
                <li>
                  The current result is kept as history and the parent is asked (by WhatsApp and email) to book an
                  assessment for {describeClass(target)}.
                </li>
                <li>
                  Passed: the change applies by itself and they continue where they were. Not passed: everything goes
                  back to {describeClass(current)}.
                </li>
              </>
            ) : (
              <li>{target.grade} needs no assessment, so the change applies straight away.</li>
            )}
          </ul>
          <div className="flex items-center gap-2">
            <SubmitButton size="sm" pendingText="Changing…">
              Confirm change
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function CancelClassChangeButton({
  applicationId,
  action,
}: {
  applicationId: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
        Cancel change
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="application_id" value={applicationId} />
      <span className="text-xs">Put everything back as it was and tell the parent?</span>
      <SubmitButton size="sm" variant="destructive" pendingText="Cancelling…">
        Yes, cancel
      </SubmitButton>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Back
      </Button>
    </form>
  );
}
