"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { submitAdmissionForm } from "@/app/apply/[token]/actions";
import { needsAssessment } from "@/lib/assessment";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { PhoneField } from "@/components/apply/phone-field";
import { SearchSelect } from "@/components/ui/search-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
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

export interface AvailableSlot {
  id: string;
  startsAt: string; // ISO instant (UTC)
}

export function AdmissionForm({
  token,
  gradeOptions,
  curriculumOptions,
  schoolTimezone,
  schoolTimezoneLabel,
  availableSlots,
  defaultStudentName,
}: {
  token: string;
  gradeOptions: readonly string[];
  curriculumOptions: readonly string[];
  schoolTimezone: string;
  schoolTimezoneLabel: string;
  availableSlots: AvailableSlot[];
  defaultStudentName?: string | null;
}) {
  const [grade, setGrade] = useState("");
  const [country, setCountry] = useState("");
  // The parent's auto-detected timezone, for the "your time" hint next to each slot.
  const [tz, setTz] = useState("");
  const hasSlots = availableSlots.length > 0;
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  // Format an instant with its weekday, in the parent's local zone or the
  // school zone. Intl can't mix dateStyle with weekday, hence explicit fields.
  const fmtWithDay = (iso: string, timeZone?: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      ...(timeZone ? { timeZone } : {}),
    });
  };
  // Passport is mandatory for applicants residing outside India.
  const passportRequired = country.trim().toLowerCase() !== "india";

  // Group same-time slots (e.g. an admin-opened batch of 9 at once) into a
  // single row, then group same-weekday/time groups into one collapsible
  // series — so a weekly-recurring batch reads as one row with an expand
  // toggle instead of a dozen near-identical rows.
  interface SlotOccurrence {
    id: string;
    startsAt: string;
    count: number;
  }
  interface SlotSeries {
    key: string;
    label: string;
    occurrences: SlotOccurrence[];
  }
  const slotSeries = useMemo<SlotSeries[]>(() => {
    const groups = new Map<string, SlotOccurrence>();
    for (const s of availableSlots) {
      const g = groups.get(s.startsAt);
      if (g) g.count += 1;
      else groups.set(s.startsAt, { id: s.id, startsAt: s.startsAt, count: 1 });
    }
    const sortedGroups = Array.from(groups.values()).sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    );
    const series = new Map<string, SlotSeries>();
    for (const g of sortedGroups) {
      const d = new Date(g.startsAt);
      const weekday = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: schoolTimezone,
      }).format(d);
      const time = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: schoolTimezone,
      }).format(d);
      const key = `${weekday}-${time}`;
      let s = series.get(key);
      if (!s) {
        s = { key, label: `${weekday}, ${time}`, occurrences: [] };
        series.set(key, s);
      }
      s.occurrences.push(g);
    }
    return Array.from(series.values());
  }, [availableSlots, schoolTimezone]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Only "KG 1" is exempt from the mandatory assessment — driven by the class
  // picked, not the child's age.
  const isGrade = grade !== "" && needsAssessment(grade);

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
            <Label htmlFor="grade">Class applying for *</Label>
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
          {(grade === "" || needsAssessment(grade)) && (
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
          <div className="space-y-1.5">
            <Label htmlFor="whatsapp">WhatsApp number *</Label>
            <PhoneField id="whatsapp" name="whatsapp" required placeholder="WhatsApp number" />
            <p className="text-xs font-medium text-destructive">
              This WhatsApp will be used for class purpose.
            </p>
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
          title="Assessment booking"
          description={
            hasSlots
              ? "This class requires an assessment. Pick a confirmed slot below — booking is instant and can't be double-booked."
              : "This class requires an assessment. No slots are open yet — our team will reach out to schedule one once you submit."
          }
        >
          {hasSlots ? (
            <div className="space-y-2">
              {slotSeries.map((series) => {
                const isMulti = series.occurrences.length > 1;
                if (!isMulti) {
                  const o = series.occurrences[0];
                  return (
                    <label
                      key={series.key}
                      className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary"
                    >
                      <input type="radio" name="slot_id" value={o.id} required className="shrink-0" />
                      <span>
                        <span className="font-medium">
                          {fmtWithDay(o.startsAt, schoolTimezone)} {schoolTimezoneLabel}
                        </span>
                        {tz && tz !== schoolTimezone && (
                          <span className="text-muted-foreground">
                            {" "}
                            · your time {fmtWithDay(o.startsAt, tz)}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                }

                const isOpen = !!expanded[series.key];
                return (
                  <div key={series.key} className="rounded-md border border-border">
                    <button
                      type="button"
                      onClick={() => setExpanded((e) => ({ ...e, [series.key]: !isOpen }))}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm"
                    >
                      <span>
                        <span className="font-medium">{series.label}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {series.occurrences.length} dates available
                        </span>
                      </span>
                      <ChevronDown
                        className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-180")}
                      />
                    </button>
                    {isOpen && (
                      <div className="divide-y divide-border border-t border-border">
                        {series.occurrences.map((o) => (
                          <label
                            key={o.id}
                            className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors has-[:checked]:bg-secondary"
                          >
                            <input type="radio" name="slot_id" value={o.id} required className="shrink-0" />
                            <span>
                              {fmtWithDay(o.startsAt, schoolTimezone)} {schoolTimezoneLabel}
                              {tz && tz !== schoolTimezone && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  · your time {fmtWithDay(o.startsAt, tz)}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Alert variant="info">
              No assessment slots are open yet. You will be notified as soon as slots become
              available.
            </Alert>
          )}
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
