"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
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
  markDoneAction,
  applicationId,
  nextFollowUpAt,
  completedAt,
}: {
  action: (formData: FormData) => void;
  markDoneAction: (formData: FormData) => void;
  applicationId: string;
  nextFollowUpAt: string | null;
  completedAt: string | null;
}) {
  const [editing, setEditing] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const isOverdue = Boolean(nextFollowUpAt && !completedAt && nextFollowUpAt < todayStr);
  const isToday = Boolean(nextFollowUpAt && !completedAt && nextFollowUpAt === todayStr);

  if (!editing) {
    return (
      <div className="space-y-1">
        {nextFollowUpAt ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs">{formatDate(nextFollowUpAt)}</span>
            {completedAt ? (
              <Badge tone="success">
                <CheckCircle2 className="mr-1 size-3" />
                Done
              </Badge>
            ) : (
              <>
                {isOverdue && <Badge tone="danger">Overdue</Badge>}
                {isToday && <Badge tone="warning">Today</Badge>}
              </>
            )}
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
          {nextFollowUpAt && !completedAt && (
            // Leaves next_follow_up_at untouched — the date itself stays
            // visible, just flagged done instead of wiped. Picking a new
            // date later (via Change) clears this flag again.
            <form action={markDoneAction}>
              <input type="hidden" name="application_id" value={applicationId} />
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
