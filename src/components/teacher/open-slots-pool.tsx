"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { cn, formatInZoneWithDay } from "@/lib/utils";

export interface PoolOccurrence {
  slotId: string;
  startsAt: string;
  count: number;
}
export interface PoolSeries {
  key: string;
  seriesLabel: string;
  occurrences: PoolOccurrence[];
  totalCount: number;
}

// Groups of open, unclaimed assessment slots. A recurring weekday/time (e.g.
// admin opened "Monday 8:30 PM" for 8 weeks) collapses into one row with an
// expand toggle instead of 8 duplicate-looking rows; a one-off date renders
// as a single row with its own Claim button.
export function OpenSlotsPool({
  series,
  schoolTz,
  schoolLabel,
  claimAction,
}: {
  series: PoolSeries[];
  schoolTz: string;
  schoolLabel: string;
  claimAction: (formData: FormData) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-2">
      {series.map((s) => {
        const isMulti = s.occurrences.length > 1;
        const isOpen = !!expanded[s.key];
        const next = s.occurrences[0];

        if (!isMulti) {
          return (
            <form
              key={s.key}
              action={claimAction}
              className="flex items-center justify-between rounded-md border border-border px-4 py-3"
            >
              <input type="hidden" name="slot_id" value={next.slotId} />
              <span className="text-sm font-medium">
                {formatInZoneWithDay(next.startsAt, schoolTz)} {schoolLabel}
                <span className="ml-2 font-normal text-muted-foreground">
                  · {next.count} slot{next.count > 1 ? "s" : ""} available
                </span>
              </span>
              <SubmitButton size="sm" pendingText="Claiming…">
                Claim
              </SubmitButton>
            </form>
          );
        }

        return (
          <div key={s.key} className="rounded-md border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-sm font-medium">
                {s.seriesLabel} {schoolLabel}
                <span className="ml-2 font-normal text-muted-foreground">
                  · {s.totalCount} slot{s.totalCount > 1 ? "s" : ""} across {s.occurrences.length} dates
                </span>
              </span>
              <div className="flex items-center gap-2">
                <form action={claimAction}>
                  <input type="hidden" name="slot_id" value={next.slotId} />
                  <SubmitButton size="sm" pendingText="Claiming…">
                    Claim next
                  </SubmitButton>
                </form>
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [s.key]: !isOpen }))}
                  aria-expanded={isOpen}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {s.occurrences.length} dates
                  <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                </button>
              </div>
            </div>
            {isOpen && (
              <div className="divide-y divide-border border-t border-border">
                {s.occurrences.map((o) => (
                  <form
                    key={o.slotId}
                    action={claimAction}
                    className="flex items-center justify-between px-4 py-2.5"
                  >
                    <input type="hidden" name="slot_id" value={o.slotId} />
                    <span className="text-sm">
                      {formatInZoneWithDay(o.startsAt, schoolTz)} {schoolLabel}
                      <span className="ml-2 text-muted-foreground">
                        · {o.count} slot{o.count > 1 ? "s" : ""}
                      </span>
                    </span>
                    <SubmitButton size="sm" pendingText="Claiming…">
                      Claim
                    </SubmitButton>
                  </form>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
