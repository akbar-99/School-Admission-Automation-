"use client";

import { useMemo, useState } from "react";
import { submitAdmissionForm } from "@/app/apply/[token]/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/submit-button";

export interface AgeConfig {
  year: number;
  cutoffMMDD: string;
  kgMin: number;
  kgMax: number;
  gradeMin: number;
}

function completedYears(dob: Date, asOf: Date): number {
  let age = asOf.getFullYear() - dob.getFullYear();
  const m = asOf.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < dob.getDate())) age -= 1;
  return age;
}

export function AdmissionForm({
  token,
  ageConfig,
  gradeOptions,
}: {
  token: string;
  ageConfig: AgeConfig;
  gradeOptions: readonly string[];
}) {
  const [dob, setDob] = useState("");

  const preview = useMemo(() => {
    if (!dob) return null;
    const cutoff = new Date(`${ageConfig.year}-${ageConfig.cutoffMMDD}T00:00:00`);
    const age = completedYears(new Date(`${dob}T00:00:00`), cutoff);
    if (Number.isNaN(age)) return null;
    if (age < ageConfig.kgMin)
      return { tone: "warning" as const, text: `Age ${age} at cutoff — below the minimum age of ${ageConfig.kgMin} for KG.` };
    if (age <= ageConfig.kgMax)
      return { tone: "info" as const, text: `Age ${age} at cutoff — detected category: KG.` };
    return { tone: "info" as const, text: `Age ${age} at cutoff — detected category: GRADE (assessment required).` };
  }, [dob, ageConfig]);

  return (
    <form action={submitAdmissionForm} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="student_name">Student full name *</Label>
          <Input id="student_name" name="student_name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dob">Date of birth *</Label>
          <Input
            id="dob"
            name="dob"
            type="date"
            required
            value={dob}
            onChange={(e) => setDob(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gender">Gender</Label>
          <Select id="gender" name="gender" defaultValue="">
            <option value="">Select…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grade">Grade applying for *</Label>
          <Select id="grade" name="grade" required defaultValue="">
            <option value="" disabled>
              Select…
            </option>
            {gradeOptions.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="previous_school">Previous school</Label>
          <Input id="previous_school" name="previous_school" />
        </div>
      </div>

      {preview && <Alert variant={preview.tone}>{preview.text}</Alert>}

      <div className="space-y-1.5">
        <Label htmlFor="documents">Documents (PDF / JPG / PNG, max 5 MB each)</Label>
        <Input
          id="documents"
          name="documents"
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png"
        />
        <p className="text-xs text-muted-foreground">
          e.g. birth certificate, previous report card, ID proof.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-1" required />
        <span>
          I consent to the school collecting and processing the above personal
          data for the purpose of admission, in line with the DPDP Act, 2023.
        </span>
      </label>

      <SubmitButton pendingText="Submitting…">Submit application</SubmitButton>
    </form>
  );
}
