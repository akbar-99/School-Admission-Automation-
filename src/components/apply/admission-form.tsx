"use client";

import { useEffect, useMemo, useState } from "react";
import { submitAdmissionForm } from "@/app/apply/[token]/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {description && <p className="-mt-1 text-xs text-muted-foreground">{description}</p>}
      {children}
    </fieldset>
  );
}

export function AdmissionForm({
  token,
  ageConfig,
  gradeOptions,
  curriculumOptions,
  schoolTimezone,
  schoolTimezoneLabel,
  defaultStudentName,
}: {
  token: string;
  ageConfig: AgeConfig;
  gradeOptions: readonly string[];
  curriculumOptions: readonly string[];
  schoolTimezone: string;
  schoolTimezoneLabel: string;
  defaultStudentName?: string | null;
}) {
  const [dob, setDob] = useState("");
  const [country, setCountry] = useState("");
  // Assessment date/time + the parent's auto-detected timezone.
  const [prefDate, setPrefDate] = useState("");
  const [prefAlt, setPrefAlt] = useState("");
  const [tz, setTz] = useState("");
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  // Convert a naive datetime-local value to a true UTC instant (browser-local).
  const toUtc = (local: string) => {
    if (!local) return "";
    const d = new Date(local);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  };
  // Format the picked instant in the parent's local zone, or the school zone.
  const fmt = (local: string, timeZone?: string) => {
    if (!local) return "";
    const d = new Date(local);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      ...(timeZone ? { timeZone } : {}),
    });
  };
  // Passport is mandatory for applicants residing outside India.
  const passportRequired = country.trim().toLowerCase() !== "india";

  const detected = useMemo(() => {
    if (!dob) return null;
    const cutoff = new Date(`${ageConfig.year}-${ageConfig.cutoffMMDD}T00:00:00`);
    const age = completedYears(new Date(`${dob}T00:00:00`), cutoff);
    if (Number.isNaN(age)) return null;
    if (age < ageConfig.kgMin)
      return {
        category: null as "KG" | "GRADE" | null,
        tone: "warning" as const,
        text: `Age ${age} at cutoff — below the minimum age of ${ageConfig.kgMin} for KG.`,
      };
    if (age <= ageConfig.kgMax)
      return { category: "KG" as const, tone: "info" as const, text: `Age ${age} at cutoff — detected category: KG.` };
    return {
      category: "GRADE" as const,
      tone: "info" as const,
      text: `Age ${age} at cutoff — detected category: GRADE (assessment required).`,
    };
  }, [dob, ageConfig]);

  const isGrade = detected?.category === "GRADE";

  return (
    <form action={submitAdmissionForm} className="space-y-6">
      <input type="hidden" name="token" value={token} />

      <Section title="Student details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="student_name">Student full name *</Label>
            <Input id="student_name" name="student_name" required defaultValue={defaultStudentName ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dob">Date of birth *</Label>
            <Input id="dob" name="dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gender">Gender *</Label>
            <Select id="gender" name="gender" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grade">Class applying for *</Label>
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
            <Label htmlFor="curriculum">Preferred curriculum *</Label>
            <Select id="curriculum" name="curriculum" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {curriculumOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">Country of residence *</Label>
            <Input
              id="country"
              name="country"
              required
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="previous_school">Detail of previous school *</Label>
            <Input id="previous_school" name="previous_school" required placeholder="School name, board, last class attended" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="current_address">Current address *</Label>
            <Textarea id="current_address" name="current_address" required className="min-h-20" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="permanent_address">Permanent address *</Label>
            <Textarea id="permanent_address" name="permanent_address" required className="min-h-20" />
          </div>
        </div>
        {detected && <Alert variant={detected.tone}>{detected.text}</Alert>}
      </Section>

      <Section title="Documents" description="PDF / JPG / PNG, max 5 MB each.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="passport">
              Passport copy {passportRequired ? "*" : "(optional for India)"}
            </Label>
            <Input
              id="passport"
              name="passport"
              type="file"
              required={passportRequired}
              accept="application/pdf,image/jpeg,image/png"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="birth_certificate">Birth certificate *</Label>
            <Input id="birth_certificate" name="birth_certificate" type="file" required accept="application/pdf,image/jpeg,image/png" />
          </div>
        </div>
      </Section>

      <Section title="Parent details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="father_name">Father full name *</Label>
            <Input id="father_name" name="father_name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="father_phone">Father&apos;s contact number *</Label>
            <Input id="father_phone" name="father_phone" type="tel" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mother_name">Mother full name *</Label>
            <Input id="mother_name" name="mother_name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mother_phone">Mother&apos;s contact number *</Label>
            <Input id="mother_phone" name="mother_phone" type="tel" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whatsapp">WhatsApp number *</Label>
            <Input id="whatsapp" name="whatsapp" type="tel" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address *</Label>
            <Input id="email" name="email" type="email" required />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The admission link, agreement, and all updates are sent to this email and WhatsApp number.
        </p>
      </Section>

      {isGrade && (
        <Section
          title="Preferred assessment date"
          description="Grade applicants require an assessment. Pick your preferred date — our team confirms the slot and time."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="preferred_assessment_date">Preferred date &amp; time *</Label>
              <Input
                id="preferred_assessment_date"
                type="datetime-local"
                required={isGrade}
                value={prefDate}
                onChange={(e) => setPrefDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="preferred_assessment_date_alt">Alternate date &amp; time (optional)</Label>
              <Input
                id="preferred_assessment_date_alt"
                type="datetime-local"
                value={prefAlt}
                onChange={(e) => setPrefAlt(e.target.value)}
              />
            </div>
          </div>
          {prefDate ? (
            <Alert variant="info">
              <div>
                Your time: <strong>{fmt(prefDate)}</strong>
                {tz ? ` (${tz})` : ""}
              </div>
              <div>
                School time: <strong>{fmt(prefDate, schoolTimezone)} {schoolTimezoneLabel}</strong>
              </div>
              {prefAlt && (
                <div className="mt-1 text-xs">
                  Alternate → School time:{" "}
                  <strong>{fmt(prefAlt, schoolTimezone)} {schoolTimezoneLabel}</strong>
                </div>
              )}
            </Alert>
          ) : (
            tz && (
              <p className="text-xs text-muted-foreground">
                Times are shown in your local timezone (<strong>{tz}</strong>); our team sees them in
                school time too.
              </p>
            )
          )}
          {/* Submit the true UTC instant + the detected timezone. */}
          <input type="hidden" name="preferred_assessment_date" value={toUtc(prefDate)} />
          <input type="hidden" name="preferred_assessment_date_alt" value={toUtc(prefAlt)} />
          <input type="hidden" name="preferred_assessment_tz" value={tz} />
        </Section>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-1" required />
        <span>
          I consent to the school collecting and processing the above personal data for the purpose of
          admission, in line with the DPDP Act, 2023.
        </span>
      </label>

      <SubmitButton pendingText="Submitting…">Submit application</SubmitButton>
    </form>
  );
}
