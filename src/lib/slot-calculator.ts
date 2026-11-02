// Pure calendar/fair-split maths behind the admin slot calculator. No
// timezone or Date-of-"now" dependencies here: every date is a plain
// "YYYY-MM-DD" calendar date and every month a "YYYY-MM" string, so the
// results are identical on the server, in the browser, and in tests.
// Weekdays follow JS numbering: 0 = Sunday … 6 = Saturday.

export const WEEKDAYS_MON_FIRST = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
] as const;

export const DEFAULT_WORKING_WEEKDAYS = [1, 2, 3, 4, 5, 6];

const pad = (n: number) => String(n).padStart(2, "0");

export function parseMonth(month: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  // Date.UTC maps years 0–99 to 1900–1999, so a typed "0099-11" would
  // silently describe another century; only plausible planning years pass.
  if (year < 2000 || year > 2099 || mon < 1 || mon > 12) return null;
  return { year, month: mon };
}

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function weekdayOfDate(ymd: string): number {
  return new Date(ymdToUtcMs(ymd)).getUTCDay();
}

export function addDaysYmd(ymd: string, days: number): string {
  const dt = new Date(ymdToUtcMs(ymd) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function datesInMonth(month: string): string[] {
  const p = parseMonth(month);
  if (!p) return [];
  const count = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${p.year}-${pad(p.month)}-${pad(i + 1)}`);
}

export function formatMonthLabel(month: string): string {
  const p = parseMonth(month);
  if (!p) return month;
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(p.year, p.month - 1, 1)),
  );
}

// Real working dates in a month: every date whose weekday is checked,
// minus holidays. `skippedHolidays` lists only the holidays that actually
// removed a working date — one on a Sunday (when Sunday isn't a working day)
// or in a different month changes nothing, so it isn't counted.
export function workingDatesInMonth(
  month: string,
  workingWeekdays: readonly number[],
  holidays: readonly string[],
): { dates: string[]; skippedHolidays: string[] } {
  const working = new Set(workingWeekdays);
  const holidaySet = new Set(holidays);
  const dates: string[] = [];
  const skippedHolidays: string[] = [];
  for (const d of datesInMonth(month)) {
    if (!working.has(weekdayOfDate(d))) continue;
    if (holidaySet.has(d)) skippedHolidays.push(d);
    else dates.push(d);
  }
  return { dates, skippedHolidays };
}

export interface SlotPlan {
  workingDaysPerWeek: number;
  workingDaysInMonth: number;
  perDay: number;
  perWeek: number;
  perMonth: number;
  eachPerDay: number;
  eachPerWeek: number;
  eachPerMonth: number;
}

// Per day = teachers × slots per teacher per day; per week uses the number
// of checked weekdays (a standard week, no holidays); per month uses the
// real working dates in that month.
export function buildSlotPlan(input: {
  teachers: number;
  slotsPerTeacherPerDay: number;
  workingDaysPerWeek: number;
  workingDaysInMonth: number;
}): SlotPlan {
  const { teachers, slotsPerTeacherPerDay: each, workingDaysPerWeek, workingDaysInMonth } = input;
  const perDay = teachers * each;
  return {
    workingDaysPerWeek,
    workingDaysInMonth,
    perDay,
    perWeek: perDay * workingDaysPerWeek,
    perMonth: perDay * workingDaysInMonth,
    eachPerDay: each,
    eachPerWeek: each * workingDaysPerWeek,
    eachPerMonth: each * workingDaysInMonth,
  };
}

export interface FairOption {
  total: number;
  each: number;
}

// The fair totals (exact multiples of the teacher count) nearest to a
// target: e.g. 25 with 8 teachers -> 24 (3 each) below, 32 (4 each) above.
// `below` is null when the only multiple under the target would be 0.
export function nearestFairNumbers(
  target: number,
  teachers: number,
): { exact: boolean; below: FairOption | null; above: FairOption | null } {
  // Safe integers only — above 2^53 the modulo below is computed on an
  // already-rounded number and can call an odd total "even".
  if (!Number.isSafeInteger(target) || !Number.isSafeInteger(teachers) || target <= 0 || teachers <= 0) {
    return { exact: false, below: null, above: null };
  }
  if (target % teachers === 0) {
    const option = { total: target, each: target / teachers };
    return { exact: true, below: option, above: option };
  }
  const each = Math.floor(target / teachers);
  return {
    exact: false,
    below: each > 0 ? { total: each * teachers, each } : null,
    above: { total: (each + 1) * teachers, each: each + 1 },
  };
}

// The first date Create slots would post for `weekday` at `time`: today if
// today is that weekday and the time is still ahead, otherwise tomorrow
// onward — the same rule as weeklyOccurrences in src/app/admin/actions.ts.
// Every date before the returned one is excluded.
export function firstPostableDate(input: {
  todayYmd: string;
  todayWeekday: number;
  nowHHMM: string;
  weekday: number;
  time: string;
}): string {
  const { todayYmd, todayWeekday, nowHHMM, weekday, time } = input;
  if (weekday === todayWeekday && time !== "" && time > nowHHMM) return todayYmd;
  return addDaysYmd(todayYmd, 1);
}

// How many `weekday` dates in `month` are on or after `fromDate`.
export function countWeekdayFrom(month: string, weekday: number, fromDate: string): number {
  return datesInMonth(month).filter((d) => d >= fromDate && weekdayOfDate(d) === weekday).length;
}
