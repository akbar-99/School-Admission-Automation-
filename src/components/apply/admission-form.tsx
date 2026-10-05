"use client";

import { useEffect, useState } from "react";
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
            <Input id="age" name="age" type="number" min={1} max={25} required className="no-spinner" />
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

// This form can't be resubmitted after a failure without losing everything —
// the server action redirects back to a fresh page load on any error (an
// address-duplicate block, a bad file, or an upload interrupted by a flaky
// mobile connection), and an uncontrolled form has no memory of what was
// typed. Documents can never be restored (browsers won't let JS set a file
// input's value), but the 12 text/select fields can be, so a retry after an
// upload hiccup doesn't mean retyping both parents' names, phone numbers and
// two addresses from scratch. Cached client-side only (sessionStorage, keyed
// by token) — never sent anywhere, and gone once the tab closes.
type CachedFields = Record<string, string>;
function cacheKey(token: string): string {
  return `apply_remaining_v1:${token}`;
}
function readCachedFields(token: string): CachedFields {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(cacheKey(token));
    return raw ? (JSON.parse(raw) as CachedFields) : {};
  } catch {
    return {};
  }
}

// Stage 2 — everything the minimal form didn't ask for. Grade is already
// fixed from stage 1 (shown read-only for confirmation, not resubmitted).
export function RemainingDetailsForm({
  token,
  grade,
  curriculumOptions,
  timingOptions,
  defaultCurriculum,
}: {
  token: string;
  grade: string;
  curriculumOptions: readonly string[];
  timingOptions: readonly string[];
  defaultCurriculum?: string | null;
}) {
  const [country, setCountry] = useState("");
  // Starts null (matches the server-rendered, always-empty markup so there's
  // no hydration mismatch); once a post-mount effect finds cached values,
  // this flips to an object and the `key` below remounts the fields below
  // with that cache as their defaults.
  const [restored, setRestored] = useState<CachedFields | null>(null);
  const isGrade = needsAssessment(grade);

  useEffect(() => {
    const cached = readCachedFields(token);
    if (Object.keys(cached).length > 0) {
      setRestored(cached);
      if (cached.country) setCountry(cached.country);
    }
  }, [token]);

  const d = (name: string) => restored?.[name] ?? "";

  function cacheFieldsOnSubmit(e: React.FormEvent<HTMLFormElement>) {
    try {
      const fd = new FormData(e.currentTarget);
      const toSave: CachedFields = {};
      for (const [key, value] of fd.entries()) {
        if (typeof value === "string" && key !== "token" && key !== "consent") {
          toSave[key] = value;
        }
      }
      sessionStorage.setItem(cacheKey(token), JSON.stringify(toSave));
    } catch {
      // sessionStorage unavailable (private browsing, etc.) — fine, just skip caching.
    }
  }

  return (
    <form action={submitRemainingDetails} onSubmit={cacheFieldsOnSubmit} className="space-y-6">
      <input type="hidden" name="token" value={token} />

      {/* Keyed so that once cached field values are found (post-mount),
          these remount fresh with that cache as their defaults — a plain
          defaultValue prop change on an already-mounted uncontrolled input
          has no effect, so a remount is the only way to apply it. */}
      <div key={restored ? "restored" : "initial"} className="space-y-6">
        <Section title="Student details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Input value={grade} disabled />
            </div>
            {timingOptions.length > 1 && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Preferred class timing</Label>
                <div className="space-y-2">
                  {timingOptions.map((t, i) => (
                    <label
                      key={t}
                      className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary"
                    >
                      <input
                        type="radio"
                        name="preferred_class_timing"
                        value={t}
                        defaultChecked={restored ? d("preferred_class_timing") === t : i === 0}
                        className="shrink-0"
                      />
                      <span>{t}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  We&apos;ll try to place your child in a class with this timing, subject to seat
                  availability.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="dob">Date of birth *</Label>
              <Input id="dob" name="dob" type="date" required defaultValue={d("dob")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gender">Gender *</Label>
              <Select id="gender" name="gender" required defaultValue={d("gender")}>
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
              <Select
                id="curriculum"
                name="curriculum"
                required
                defaultValue={restored?.curriculum ?? defaultCurriculum ?? ""}
              >
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
                  defaultValue={d("previous_school")}
                />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="current_address">Current address *</Label>
              <Textarea
                id="current_address"
                name="current_address"
                required
                className="min-h-20"
                defaultValue={d("current_address")}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="permanent_address">Permanent address *</Label>
              <Textarea
                id="permanent_address"
                name="permanent_address"
                required
                className="min-h-20"
                defaultValue={d("permanent_address")}
              />
            </div>
          </div>
        </Section>

        <Section title="Documents" description="PDF / JPG / PNG, max 5 MB each.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="passport">Passport/Aadhaar *</Label>
              <Input
                id="passport"
                name="passport"
                type="file"
                required
                accept="application/pdf,image/jpeg,image/png"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="birth_certificate">Birth certificate *</Label>
              <Input id="birth_certificate" name="birth_certificate" type="file" required accept="application/pdf,image/jpeg,image/png" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="photo">Photo *</Label>
              <Input id="photo" name="photo" type="file" required accept="application/pdf,image/jpeg,image/png" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pen_number">PEN Number (optional)</Label>
              <Input id="pen_number" name="pen_number" placeholder="PEN number" defaultValue={d("pen_number")} />
            </div>
          </div>
          {restored && (
            <p className="text-xs text-muted-foreground">
              We&apos;ve restored the details you entered last time — you&apos;ll just need to
              re-attach these 3 files (browsers don&apos;t allow re-filling them automatically).
            </p>
          )}
        </Section>

        <Section title="Parent details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="father_name">Father&apos;s name *</Label>
              <Input id="father_name" name="father_name" required defaultValue={d("father_name")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="father_phone">Father&apos;s contact number *</Label>
              <PhoneField
                id="father_phone"
                name="father_phone"
                required
                placeholder="Contact number"
                defaultValue={d("father_phone")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mother_name">Mother&apos;s name *</Label>
              <Input id="mother_name" name="mother_name" required defaultValue={d("mother_name")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mother_phone">Mother&apos;s contact number *</Label>
              <PhoneField
                id="mother_phone"
                name="mother_phone"
                required
                placeholder="Contact number"
                defaultValue={d("mother_phone")}
              />
            </div>
          </div>
        </Section>
      </div>

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
