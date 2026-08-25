"use client";

import { useRef } from "react";
import { SubmitButton } from "@/components/submit-button";

// Confirms before revoking a staff member's login access.
export function RemoveStaffButton({
  action,
  userId,
  name,
}: {
  action: (formData: FormData) => void;
  userId: string;
  name: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Remove ${name}? They will lose access immediately.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="user_id" value={userId} />
      <SubmitButton size="sm" variant="destructive" pendingText="Removing…">
        Remove
      </SubmitButton>
    </form>
  );
}
