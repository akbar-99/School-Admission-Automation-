import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKING_WEEKDAYS,
  buildSlotPlan,
  countWeekdayFrom,
  firstPostableDate,
  formatMonthLabel,
  nearestFairNumbers,
  workingDatesInMonth,
} from "./slot-calculator";

test("November 2026 has 25 Mon–Sat working days", () => {
  const { dates, skippedHolidays } = workingDatesInMonth("2026-11", DEFAULT_WORKING_WEEKDAYS, []);
  assert.equal(dates.length, 25);
  assert.equal(dates[0], "2026-11-02"); // Nov 1 is a Sunday
  assert.equal(dates.at(-1), "2026-11-30");
  assert.deepEqual(skippedHolidays, []);
});

test("November 2026 has 21 Mon–Fri working days", () => {
  assert.equal(workingDatesInMonth("2026-11", [1, 2, 3, 4, 5], []).dates.length, 21);
});

test("only holidays on a working day in that month reduce the count", () => {
  const { dates, skippedHolidays } = workingDatesInMonth("2026-11", DEFAULT_WORKING_WEEKDAYS, [
    "2026-11-14", // Saturday — a working day, so it's skipped
    "2026-11-15", // Sunday — not a working day, changes nothing
    "2026-12-25", // other month — ignored
  ]);
  assert.equal(dates.length, 24);
  assert.ok(!dates.includes("2026-11-14"));
  assert.deepEqual(skippedHolidays, ["2026-11-14"]);
});

test("no working days checked gives 0", () => {
  assert.equal(workingDatesInMonth("2026-11", [], []).dates.length, 0);
});

test("invalid month gives no dates", () => {
  assert.equal(workingDatesInMonth("2026-13", DEFAULT_WORKING_WEEKDAYS, []).dates.length, 0);
  assert.equal(workingDatesInMonth("nonsense", DEFAULT_WORKING_WEEKDAYS, []).dates.length, 0);
  // Years 0–99 would otherwise be read by Date.UTC as 1900–1999.
  assert.equal(workingDatesInMonth("0099-11", DEFAULT_WORKING_WEEKDAYS, []).dates.length, 0);
});

test("February 2028 (leap year) has 29 days, 25 of them Mon–Sat", () => {
  assert.equal(workingDatesInMonth("2028-02", [0, 1, 2, 3, 4, 5, 6], []).dates.length, 29);
  assert.equal(workingDatesInMonth("2028-02", DEFAULT_WORKING_WEEKDAYS, []).dates.length, 25);
});

test("plan: 13 teachers, 1 slot each per day, Mon–Sat, November 2026", () => {
  const plan = buildSlotPlan({ teachers: 13, slotsPerTeacherPerDay: 1, workingDaysPerWeek: 6, workingDaysInMonth: 25 });
  assert.deepEqual(plan, {
    workingDaysPerWeek: 6,
    workingDaysInMonth: 25,
    perDay: 13,
    perWeek: 78,
    perMonth: 325,
    eachPerDay: 1,
    eachPerWeek: 6,
    eachPerMonth: 25,
  });
});

test("plan: 8 teachers, 2 slots each per day, Mon–Fri, November 2026", () => {
  const plan = buildSlotPlan({ teachers: 8, slotsPerTeacherPerDay: 2, workingDaysPerWeek: 5, workingDaysInMonth: 21 });
  assert.equal(plan.perDay, 16);
  assert.equal(plan.perWeek, 80);
  assert.equal(plan.perMonth, 336);
  assert.equal(plan.eachPerWeek, 10);
  assert.equal(plan.eachPerMonth, 42);
  // Every total divides evenly — that's the point of planning per teacher.
  assert.equal(plan.perMonth % 8, 0);
});

test("nearest fair numbers: 25 with 8 teachers -> 24 (3 each) and 32 (4 each)", () => {
  assert.deepEqual(nearestFairNumbers(25, 8), {
    exact: false,
    below: { total: 24, each: 3 },
    above: { total: 32, each: 4 },
  });
});

test("nearest fair numbers: an exact multiple is already fair", () => {
  const r = nearestFairNumbers(26, 13);
  assert.equal(r.exact, true);
  assert.deepEqual(r.below, { total: 26, each: 2 });
});

test("nearest fair numbers: fewer slots than teachers has no fair number below", () => {
  assert.deepEqual(nearestFairNumbers(5, 13), { exact: false, below: null, above: { total: 13, each: 1 } });
});

test("nearest fair numbers: empty, zero or invalid input gives nothing", () => {
  for (const [target, teachers] of [[0, 8], [-4, 8], [10, 0], [2.5, 8], [2 ** 53 + 1, 2], [Infinity, 8]]) {
    assert.deepEqual(nearestFairNumbers(target, teachers), { exact: false, below: null, above: null });
  }
});

test("first postable date matches the Create slots rule", () => {
  const base = { todayYmd: "2026-11-02", todayWeekday: 1, nowHHMM: "10:00" };
  assert.equal(firstPostableDate({ ...base, weekday: 1, time: "19:00" }), "2026-11-02"); // later today
  assert.equal(firstPostableDate({ ...base, weekday: 1, time: "09:00" }), "2026-11-03"); // already passed
  assert.equal(firstPostableDate({ ...base, weekday: 1, time: "10:00" }), "2026-11-03"); // starting now counts as passed
  assert.equal(firstPostableDate({ ...base, weekday: 1, time: "" }), "2026-11-03"); // no time picked yet
  assert.equal(firstPostableDate({ ...base, weekday: 3, time: "19:00" }), "2026-11-03"); // another weekday
});

test("weekday occurrences left in a month", () => {
  assert.equal(countWeekdayFrom("2026-11", 1, "2026-11-02"), 5); // Mondays 2, 9, 16, 23, 30
  assert.equal(countWeekdayFrom("2026-11", 1, "2026-11-03"), 4);
  assert.equal(countWeekdayFrom("2026-11", 0, "2026-11-01"), 5); // Sundays 1, 8, 15, 22, 29
  assert.equal(countWeekdayFrom("2026-11", 1, "2026-12-01"), 0);
});

test("month label", () => {
  assert.equal(formatMonthLabel("2026-11"), "November 2026");
});
