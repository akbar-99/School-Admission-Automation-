"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

// A counselor's own reminder date on a lead — collapsed to plain text by
// default (matches LeadRemarksCell's reveal pattern). The reminder itself
// (WhatsApp/email, to this lead's creator only) is sent by a daily cron
// (src/app/api/cron/follow-up-reminders); this cell only sets the date.
export function LeadFollowUpCell({
  action,
  applicationId,
  nextFollowUpAt,
}: {
  action: (formData: FormData) => void;
  applicationId: string;
  nextFollowUpAt: string | null;
}) {
  const [editing, setEditing] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const isOverdue = Boolean(nextFollowUpAt && nextFollowUpAt < todayStr);
  const isToday = nextFollowUpAt === todayStr;

  if (!editing) {
    return (
      <div className="space-y-1">
        {nextFollowUpAt ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs">{formatDate(nextFollowUpAt)}</span>
            {isOverdue && <Badge tone="danger">Overdue</Badge>}
            {isToday && <Badge tone="warning">Today</Badge>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Not set</p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {nextFollowUpAt ? "Change" : "Set follow-up"}
          </button>
          {nextFollowUpAt && (
            // One click, no date picker — clears next_follow_up_at, which
            // is exactly what stops the Overdue/Today badge, the WhatsApp
            // cron, and the in-portal popup for this lead. Needing a new
            // follow-up later just means picking a fresh date.
            <form action={action}>
              <input type="hidden" name="application_id" value={applicationId} />
              <input type="hidden" name="next_follow_up_at" value="" />
              <button type="submit" className="text-xs text-primary underline-offset-2 hover:underline">
                Mark done
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="w-40 space-y-1.5">
      <input type="hidden" name="application_id" value={applicationId} />
      <Input
        name="next_follow_up_at"
        type="date"
        defaultValue={nextFollowUpAt ?? ""}
        className="h-9 text-xs"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" variant="outline" pendingText="Saving…">
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
