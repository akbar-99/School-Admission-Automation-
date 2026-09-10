"use client";

import { useState } from "react";
import { submitMinimalForm, submitRemainingDetails } from "@/app/apply/[token]/actions";
import { needsAssessment } from "@/lib/assessment";
import { COUNTRIES } from "@/lib/countries";
import { PhoneField } from "@/components/apply/phone-field";
import { SearchSelect } from "@/components/ui/search-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";

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

// Stage 1 — just enough to identify the applicant and schedule (or skip) an
// assessment. Documents, parent details and DOB come later, in
// RemainingDetailsForm, once it's actually worth collecting the full
// paperwork.
export function MinimalAdmissionForm({
  token,
  gradeOptions,
  defaultStudentName,
}: {
  token: string;
  gradeOptions: readonly string[];
  defaultStudentName?: string | null;
}) {
  const [grade, setGrade] = useState("");

  return (
    <form action={submitMinimalForm} className="space-y-6">
      <input type="hidden" name="token" value={token} />

      <Section title="Student details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="student_name">Student&apos;s name *</Label>
            <Input id="student_name" name="student_name" required defaultValue={defaultStudentName ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grade">Class *</Label>
            <Select
              id="grade"
              name="grade"
              required
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
            >
              <option value="" disabled>
                Select…
              </option>
              {gradeOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
            {grade && (
              <p className="text-xs text-muted-foreground">
                {needsAssessment(grade)
                  ? "This class requires an assessment."
                  : "This class does not require an assessment."}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="age">Age *</Label>
            <Input id="age" name="age" type="number" min={1} max={25} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address *</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whatsapp">WhatsApp number *</Label>
            <PhoneField id="whatsapp" name="whatsapp" required placeholder="WhatsApp number" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          We&apos;ll use this email and WhatsApp number for all further updates, including the
          assessment and admission agreement.
        </p>
      </Section>

      <SubmitButton pendingText="Submitting…">Submit</SubmitButton>
    </form>
  );
}

// Stage 2 — everything the minimal form didn't ask for. Grade is already
// fixed from stage 1 (shown read-only for confirmation, not resubmitted).
export function RemainingDetailsForm({
  token,
  grade,
  curriculumOptions,
}: {
  token: string;
  grade: string;
  curriculumOptions: readonly string[];
}) {
  const [country, setCountry] = useState("");
  // Passport is mandatory for applicants residing outside India.
  const passportRequired = country.trim().toLowerCase() !== "india";
  const isGrade = needsAssessment(grade);

  return (
    <form action={submitRemainingDetails} className="space-y-6">
      <input type="hidden" name="token" value={token} />

      <Section title="Student details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Class</Label>
            <Input value={grade} disabled />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dob">Date of birth *</Label>
            <Input id="dob" name="dob" type="date" required />
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
            <Label>Country of residence *</Label>
            <SearchSelect
              name="country"
              ariaLabel="Country of residence"
              value={country}
              onChange={setCountry}
              placeholder="Select country…"
              searchPlaceholder="Type a country…"
              options={COUNTRIES.map((c) => ({ value: c, search: c, label: c }))}
            />
          </div>
          {isGrade && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="previous_school">Detail of previous school</Label>
              <Input
                id="previous_school"
                name="previous_school"
                placeholder="School name, board, last class attended"
              />
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="current_address">Current address *</Label>
            <Textarea id="current_address" name="current_address" required className="min-h-20" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="permanent_address">Permanent address *</Label>
            <Textarea id="permanent_address" name="permanent_address" required className="min-h-20" />
          </div>
        </div>
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
            <PhoneField id="father_phone" name="father_phone" required placeholder="Contact number" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mother_name">Mother full name *</Label>
            <Input id="mother_name" name="mother_name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mother_phone">Mother&apos;s contact number *</Label>
            <PhoneField id="mother_phone" name="mother_phone" required placeholder="Contact number" />
          </div>
        </div>
      </Section>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-1" required />
        <span>
          I consent to the school collecting and processing the above personal data for the purpose of
          admission, in line with the DPDP Act, 2023.
        </span>
      </label>

      <SubmitButton pendingText="Submitting…">Submit details</SubmitButton>
    </form>
  );
}
