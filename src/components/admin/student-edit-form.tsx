"use client";

import { useState } from "react";
import { updateStudentDetails } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import type { Gender } from "@/lib/types";

export function StudentEditForm({
  applicationId,
  fullName,
  dob,
  gender,
  previousSchool,
  countryOfResidence,
  penNumber,
  currentAddress,
  permanentAddress,
}: {
  applicationId: string;
  fullName: string;
  dob: string;
  gender: Gender | null;
  previousSchool: string | null;
  countryOfResidence: string | null;
  penNumber: string | null;
  currentAddress: string | null;
  permanentAddress: string | null;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-primary underline-offset-2 hover:underline print:hidden"
      >
        Edit student details
      </button>
    );
  }

  return (
    <form
      action={updateStudentDetails}
      className="sm:col-span-2 lg:col-span-3 flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3"
    >
      <input type="hidden" name="application_id" value={applicationId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="full_name" className="text-xs">Student&apos;s name</Label>
          <Input id="full_name" name="full_name" defaultValue={fullName} required className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dob" className="text-xs">Date of birth</Label>
          <Input id="dob" name="dob" type="date" defaultValue={dob} required className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gender" className="text-xs">Gender</Label>
          <Select id="gender" name="gender" defaultValue={gender ?? ""} className="h-9 text-sm">
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="previous_school" className="text-xs">Previous school</Label>
          <Input id="previous_school" name="previous_school" defaultValue={previousSchool ?? ""} className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="country_of_residence" className="text-xs">Country of residence</Label>
          <Input id="country_of_residence" name="country_of_residence" defaultValue={countryOfResidence ?? ""} className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pen_number" className="text-xs">PEN number</Label>
          <Input id="pen_number" name="pen_number" defaultValue={penNumber ?? ""} className="h-9 text-sm" />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="current_address" className="text-xs">Current address</Label>
          <Textarea id="current_address" name="current_address" defaultValue={currentAddress ?? ""} className="text-sm" rows={2} />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="permanent_address" className="text-xs">Permanent address</Label>
          <Textarea id="permanent_address" name="permanent_address" defaultValue={permanentAddress ?? ""} className="text-sm" rows={2} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
