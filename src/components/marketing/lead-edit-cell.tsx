"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { PhoneField } from "@/components/apply/phone-field";
import { SubmitButton } from "@/components/submit-button";

// Lets a rep fill in or correct a lead's parent/student details — shown
// as an always-open form for a contactless DM lead (there's nothing to
// summarize yet), or collapsed behind an "Edit" link once a phone is on
// file. Posts to updateLeadDetails (src/app/marketing/actions.ts), which
// also sends the N-1 admission link the first time real contact info lands.
export function LeadEditCell({
  action,
  applicationId,
  parentName,
  phone,
  email,
  studentName,
}: {
  action: (formData: FormData) => void;
  applicationId: string;
  parentName: string;
  phone: string | null;
  email: string | null;
  studentName: string | null;
}) {
  const [editing, setEditing] = useState(!phone);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="block text-xs text-primary underline-offset-2 hover:underline"
      >
        Edit
      </button>
    );
  }

  return (
    <form
      action={action}
      className="mt-1 flex w-64 flex-col gap-1.5 rounded-md border border-border bg-card p-2.5"
    >
      <input type="hidden" name="application_id" value={applicationId} />
      <Input name="parent_name" defaultValue={parentName} placeholder="Parent's name" required className="h-8 text-xs" />
      <PhoneField id={`phone-${applicationId}`} name="phone" defaultValue={phone ?? ""} required placeholder="9XXXXXXXXX" />
      <Input name="email" type="email" defaultValue={email ?? ""} placeholder="Email (optional)" className="h-8 text-xs" />
      <Input
        name="student_name"
        defaultValue={studentName ?? ""}
        placeholder="Student's name (optional)"
        className="h-8 text-xs"
      />
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" variant="outline" pendingText="Saving…">
          Save
        </SubmitButton>
        {phone && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
