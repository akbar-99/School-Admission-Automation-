"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Live "what-if" preview of the fair-share formula (see claim_assessment_slot)
// — purely client-side arithmetic, no server round-trip, so the admin can
// test a few quantities before actually posting anything via Create slots.
export function WeeklySlotCalculator({
  currentTotal,
  teacherCount,
}: {
  currentTotal: number;
  teacherCount: number;
}) {
  const [extra, setExtra] = useState("");
  const parsedExtra = Number(extra);
  // A number input still accepts something like "1e309" — finite enough to
  // pass its own validity check, but it overflows to Infinity once parsed,
  // which would otherwise render literally as "Infinity" below.
  const extraNum = Number.isFinite(parsedExtra) ? Math.max(0, Math.floor(parsedExtra)) : 0;
  const projectedTotal = currentTotal + extraNum;
  const safeTeacherCount = Math.max(teacherCount, 1);
  const projectedCap = teacherCount > 0 ? Math.ceil(projectedTotal / safeTeacherCount) : 0;

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="calc_extra">If you create this many more open slots this week</Label>
          <Input
            id="calc_extra"
            type="number"
            min={0}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="0"
            className="w-32"
          />
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">New total </span>
          <span className="font-medium">{projectedTotal}</span>
          <span className="text-muted-foreground"> ÷ {teacherCount} active teacher{teacherCount === 1 ? "" : "s"} = </span>
          {teacherCount > 0 ? (
            <span className="font-semibold text-primary">{projectedCap} each</span>
          ) : (
            <span className="font-semibold text-destructive">no active teachers</span>
          )}
        </p>
      </div>
    </div>
  );
}
