"use client";

import { useState } from "react";
import { updateMinimalDetails } from "@/app/apply/[token]/actions";
import { PhoneField } from "@/components/apply/phone-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/submit-button";

// The stage-1 details, shown and editable on every step from FORM_SUBMITTED
// onward — a typo in the name/age/email/WhatsApp shouldn't have to stay
// locked in for the rest of the flow. Class can only be changed here while
// still at FORM_SUBMITTED (see updateMinimalDetails for why).
export function EditableApplicantDetails({
  token,
  studentName,
  grade,
  gradeOptions,
  gradeEditable,
  age,
  email,
  whatsapp,
}: {
  token: string;
  studentName: string;
  grade: string;
  gradeOptions: readonly string[];
  gradeEditable: boolean;
  age: number | null;
  email: string;
  whatsapp: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Your details</CardTitle>
          <CardDescription>What we have on file — edit anything that&apos;s wrong.</CardDescription>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </CardHeader>
      <CardContent>
        {!open ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Student&apos;s name</dt>
              <dd className="font-medium">{studentName || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Class</dt>
              <dd className="font-medium">{grade || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Age</dt>
              <dd className="font-medium">{age ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="font-medium">{email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">WhatsApp number</dt>
              <dd className="font-medium">{whatsapp || "—"}</dd>
            </div>
          </dl>
        ) : (
          <form action={updateMinimalDetails} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit_student_name">Student&apos;s name *</Label>
                <Input id="edit_student_name" name="student_name" required defaultValue={studentName} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit_grade">Class *</Label>
                {gradeEditable ? (
                  <Select id="edit_grade" name="grade" required defaultValue={grade}>
                    {gradeOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <>
                    <Input value={grade} disabled />
                    <p className="text-xs text-muted-foreground">
                      Class can&apos;t be changed once your assessment is underway. Contact the
                      school if this needs to change.
                    </p>
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit_age">Age *</Label>
                <Input id="edit_age" name="age" type="number" min={1} max={25} required defaultValue={age ?? ""} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit_email">Email address *</Label>
                <Input id="edit_email" name="email" type="email" required defaultValue={email} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit_whatsapp">WhatsApp number *</Label>
                <PhoneField id="edit_whatsapp" name="whatsapp" required defaultValue={whatsapp} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
