"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toZonedInputValue } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useCreateSlots } from "@/components/admin/create-slots-context";
import {
  DEFAULT_WORKING_WEEKDAYS,
  WEEKDAYS_MON_FIRST,
  buildSlotPlan,
  datesInMonth,
  formatMonthLabel,
  nearestFairNumbers,
  weekdayOfDate,
  workingDatesInMonth,
} from "@/lib/slot-calculator";

// Create slots caps "Slots per week" at 50 (AssessmentSlotSchema.quantity).
const MAX_PER_POSTING = 50;

// Calculator inputs survive the page remount that follows every Create
// slots post (server redirect), for this browser tab only.
const STORAGE_KEY = "admin.slotCalculator.v1";

interface StoredInputs {
  month: string;
  teachers: string;
  perTeacherPerDay: string;
  workingWeekdays: number[];
  holidays: string[];
  target: string;
  // The live teacher count and current month when saved — if either has
  // moved on since, the saved value is stale and the live one is used.
  baseTeachers: number;
  baseMonth: string;
}

function readStoredInputs(): StoredInputs | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredInputs;
    const strings = [s?.month, s?.teachers, s?.perTeacherPerDay, s?.target, s?.baseMonth];
    if (
      !strings.every((v) => typeof v === "string") ||
      typeof s.baseTeachers !== "number" ||
      !Array.isArray(s.workingWeekdays) ||
      !s.workingWeekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ||
      !Array.isArray(s.holidays) ||
      !s.holidays.every((h) => typeof h === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h))
    ) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function toPositiveInt(value: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// "Mon–Sat" for a run of 3+ consecutive days (Monday-first), otherwise a list.
function describeWeekdays(selected: readonly number[]): string {
  const ordered = WEEKDAYS_MON_FIRST.filter((d) => selected.includes(d.value));
  if (ordered.length === 0) return "none";
  const indexes = ordered.map((d) => WEEKDAYS_MON_FIRST.indexOf(d));
  const contiguous = indexes.every((idx, i) => i === 0 || idx === indexes[i - 1] + 1);
  if (contiguous && ordered.length >= 3) return `${ordered[0].short}–${ordered[ordered.length - 1].short}`;
  return ordered.map((d) => d.short).join(", ");
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function SlotCalculator({ defaultTeachers, currentMonth }: { defaultTeachers: number; currentMonth: string }) {
  const { applyPlan, schoolTz } = useCreateSlots();
  const [month, setMonth] = useState(currentMonth);
  const [teachers, setTeachers] = useState(String(defaultTeachers));
  const [perTeacherPerDay, setPerTeacherPerDay] = useState("1");
  const [workingWeekdays, setWorkingWeekdays] = useState<number[]>(DEFAULT_WORKING_WEEKDAYS);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [holidayDraft, setHolidayDraft] = useState("");
  const [target, setTarget] = useState("");
  const [restored, setRestored] = useState(false);

  // Read after hydration so the first render matches the server's defaults.
  useEffect(() => {
    const saved = readStoredInputs();
    if (saved) {
      // A staff change or a new month since saving makes those two stale;
      // everything else the admin typed is still theirs to keep.
      if (saved.baseMonth === currentMonth) setMonth(saved.month);
      if (saved.baseTeachers === defaultTeachers) setTeachers(saved.teachers);
      setPerTeacherPerDay(saved.perTeacherPerDay);
      setWorkingWeekdays(saved.workingWeekdays);
      setHolidays(saved.holidays);
      setTarget(saved.target);
    }
    setRestored(true);
    // Restore once per mount: the two defaults are deliberately not
    // dependencies, or a refreshed value would re-restore over live edits.
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      const stored: StoredInputs = {
        month,
        teachers,
        perTeacherPerDay,
        workingWeekdays,
        holidays,
        target,
        baseTeachers: defaultTeachers,
        baseMonth: currentMonth,
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage blocked — the inputs just reset after the next post.
    }
  }, [restored, month, teachers, perTeacherPerDay, workingWeekdays, holidays, target, defaultTeachers, currentMonth]);

  const teacherCount = toPositiveInt(teachers);
  const each = toPositiveInt(perTeacherPerDay);
  const monthDates = datesInMonth(month);
  const monthValid = monthDates.length > 0;
  const { dates, skippedHolidays } = workingDatesInMonth(month, workingWeekdays, holidays);
  const plan = buildSlotPlan({
    teachers: teacherCount,
    slotsPerTeacherPerDay: each,
    workingDaysPerWeek: workingWeekdays.length,
    workingDaysInMonth: dates.length,
  });
  const targetNum = Number(target);
  const fair = nearestFairNumbers(targetNum, teacherCount);
  const monthLabel = formatMonthLabel(month);
  const daysLabel = describeWeekdays(workingWeekdays);

  // Create slots only ever posts from the next upcoming date, so a holiday
  // already behind us can't have a slot posted on it. Only reached once the
  // admin has added a holiday (client-side), never during the server render.
  function upcomingSkippedHolidays(): string[] {
    const todayYmd = toZonedInputValue(new Date(), schoolTz).slice(0, 10);
    return skippedHolidays.filter((h) => h >= todayYmd);
  }

  function toggleWeekday(value: number) {
    setWorkingWeekdays((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function addHoliday() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDraft) || holidays.includes(holidayDraft)) return;
    setHolidays((prev) => [...prev, holidayDraft].sort());
    setHolidayDraft("");
  }

  function holidayNote(ymd: string): string | null {
    if (skippedHolidays.includes(ymd)) return null;
    if (!ymd.startsWith(`${month}-`)) return "other month";
    if (!workingWeekdays.includes(weekdayOfDate(ymd))) return "not a working day";
    return null;
  }

  const fillBlockedReason =
    month !== currentMonth
      ? `Create slots always starts from the next upcoming date, so it can only be filled for ${formatMonthLabel(currentMonth)}.`
      : teacherCount === 0
        ? "Enter the number of teachers first."
        : teacherCount > MAX_PER_POSTING
          ? `Create slots allows at most ${MAX_PER_POSTING} slots per time.`
          : each === 0
            ? "Enter slots per teacher per day first."
            : workingWeekdays.length === 0
              ? "Pick at least one working day first."
              : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="calc_month">Month</Label>
          <Input
            id="calc_month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="calc_teachers">Active teachers</Label>
          <Input
            id="calc_teachers"
            type="number"
            min={1}
            value={teachers}
            onChange={(e) => setTeachers(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="calc_each">Slots per teacher per day</Label>
          <Input
            id="calc_each"
            type="number"
            min={1}
            value={perTeacherPerDay}
            onChange={(e) => setPerTeacherPerDay(e.target.value)}
            className="w-28"
          />
        </div>
        {teachers !== String(defaultTeachers) && (
          <button
            type="button"
            onClick={() => setTeachers(String(defaultTeachers))}
            className="pb-3 text-xs font-medium text-primary hover:underline"
          >
            Reset to {defaultTeachers} active now
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Working days</Label>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS_MON_FIRST.map((d) => (
            <label
              key={d.value}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                checked={workingWeekdays.includes(d.value)}
                onChange={() => toggleWeekday(d.value)}
                className="size-4 rounded border-input accent-primary"
              />
              {d.short}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="calc_holiday">Holidays to skip (optional)</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="calc_holiday"
            type="date"
            value={holidayDraft}
            min={monthValid ? monthDates[0] : undefined}
            max={monthValid ? monthDates[monthDates.length - 1] : undefined}
            onChange={(e) => setHolidayDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addHoliday();
              }
            }}
            className="w-44"
          />
          <Button type="button" variant="outline" size="sm" onClick={addHoliday} disabled={!holidayDraft}>
            Add
          </Button>
          {holidays.map((h) => {
            const note = holidayNote(h);
            return (
              <span
                key={h}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-1 pl-2.5 pr-1.5 text-xs"
              >
                {formatDay(h)}
                {note && <span className="text-muted-foreground">({note}, not counted)</span>}
                <button
                  type="button"
                  onClick={() => setHolidays((prev) => prev.filter((x) => x !== h))}
                  aria-label={`Remove holiday ${formatDay(h)}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {!monthValid ? (
        <p className="text-sm text-muted-foreground">Pick a month to see the numbers.</p>
      ) : teacherCount === 0 || each === 0 ? (
        <p className="text-sm text-muted-foreground">Enter the number of teachers and slots per teacher per day.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">{monthLabel}</span>
            <span className="text-muted-foreground">: </span>
            <span className="font-medium">{dates.length}</span>
            <span className="text-muted-foreground">
              {" "}
              working day{dates.length === 1 ? "" : "s"} ({daysLabel})
              {skippedHolidays.length > 0 &&
                ` · ${skippedHolidays.length} holiday${skippedHolidays.length === 1 ? "" : "s"} skipped`}
            </span>
          </p>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH />
                  <TH>Per day</TH>
                  <TH>Per week</TH>
                  <TH>Per month</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD className="font-medium">Slots to create</TD>
                  <TD>{plan.perDay}</TD>
                  <TD>{plan.perWeek}</TD>
                  <TD className="font-semibold text-primary">{plan.perMonth}</TD>
                </TR>
                <TR>
                  <TD className="font-medium">Each teacher gets</TD>
                  <TD>{plan.eachPerDay}</TD>
                  <TD>{plan.eachPerWeek}</TD>
                  <TD className="font-semibold text-primary">{plan.eachPerMonth}</TD>
                </TR>
              </TBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Per week counts a full week of {plan.workingDaysPerWeek} working day
            {plan.workingDaysPerWeek === 1 ? "" : "s"}; per month counts the real dates in {monthLabel}
            {skippedHolidays.length > 0 ? ", minus holidays" : ""}.
          </p>

          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-sm">
              One posting in Create slots puts <span className="font-medium">{teacherCount}</span> slots at one
              time — one per teacher. To reach <span className="font-medium">{plan.perDay}</span> a day, post at{" "}
              <span className="font-medium">{each}</span> different time{each === 1 ? "" : "s"} on each working day (
              {daysLabel}).
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                disabled={fillBlockedReason !== null}
                onClick={() => applyPlan({ quantity: teacherCount, month, workingWeekdays })}
              >
                Use these numbers
              </Button>
              {fillBlockedReason && <span className="text-xs text-muted-foreground">{fillBlockedReason}</span>}
            </div>
            {skippedHolidays.length > 0 && fillBlockedReason === null && upcomingSkippedHolidays().length > 0 && (
              <p className="text-xs text-warning">
                Create slots doesn&apos;t skip holidays yet — delete any slot on{" "}
                {upcomingSkippedHolidays().map(formatDay).join(", ")} from &quot;All slots&quot; after posting.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1.5 border-t border-border pt-5">
        <Label htmlFor="calc_target">I have a number</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="calc_target"
            type="number"
            min={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="e.g. 25"
            className="w-32"
          />
          {teacherCount === 0 ? (
            <span className="text-sm text-muted-foreground">Enter the number of teachers first.</span>
          ) : target.trim() === "" ? (
            <span className="text-sm text-muted-foreground">
              Type a total to see the nearest numbers that split evenly between {teacherCount} teachers.
            </span>
          ) : !fair.above ? (
            <span className="text-sm text-muted-foreground">Enter a whole number above 0.</span>
          ) : fair.exact ? (
            <span className="text-sm">
              <Badge tone="success">
                {targetNum} = {fair.above.each} each
              </Badge>{" "}
              <span className="text-muted-foreground">splits evenly between {teacherCount} teachers.</span>
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {targetNum} doesn&apos;t split evenly between {teacherCount} teachers. Nearest fair numbers:
              </span>
              {fair.below && (
                <Badge tone="info">
                  {fair.below.total} = {fair.below.each} each
                </Badge>
              )}
              <Badge tone="info">
                {fair.above.total} = {fair.above.each} each
              </Badge>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
