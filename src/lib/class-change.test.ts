import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classChangeKind,
  curriculumOfGrade,
  describeClass,
  nextClass,
  otherCurriculumClass,
  resolveCurriculum,
} from "./class-change";

// The school's real class list (sections table, 2026-11).
const CLASSES = [
  "KG 1", "KG 2",
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `STD ${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `STAGE ${n}`),
];

test("curriculum comes from the class name, except KG", () => {
  assert.equal(curriculumOfGrade("STD 3"), "CBSE");
  assert.equal(curriculumOfGrade("stage 3"), "Cambridge");
  assert.equal(curriculumOfGrade("KG 2"), null);
});

test("other curriculum: STD <-> STAGE keeps the number", () => {
  assert.deepEqual(otherCurriculumClass("STD 3", "CBSE", CLASSES), { grade: "STAGE 3", curriculum: "Cambridge" });
  assert.deepEqual(otherCurriculumClass("STAGE 8", "Cambridge", CLASSES), { grade: "STD 8", curriculum: "CBSE" });
});

test("other curriculum for KG keeps the class and flips the curriculum", () => {
  assert.deepEqual(otherCurriculumClass("KG 2", "CBSE", CLASSES), { grade: "KG 2", curriculum: "Cambridge" });
  assert.equal(otherCurriculumClass("KG 2", null, CLASSES), null); // curriculum unknown
});

test("one class up", () => {
  assert.deepEqual(nextClass("STD 3", "CBSE", CLASSES), { grade: "STD 4", curriculum: "CBSE" });
  assert.deepEqual(nextClass("STAGE 2", "Cambridge", CLASSES), { grade: "STAGE 3", curriculum: "Cambridge" });
  assert.deepEqual(nextClass("KG 1", "Cambridge", CLASSES), { grade: "KG 2", curriculum: "Cambridge" });
  assert.deepEqual(nextClass("KG 2", "CBSE", CLASSES), { grade: "STD 1", curriculum: "CBSE" });
  assert.deepEqual(nextClass("KG 2", "Cambridge", CLASSES), { grade: "STAGE 1", curriculum: "Cambridge" });
});

test("no class above the top one, or when KG 2's curriculum is unknown", () => {
  assert.equal(nextClass("STD 8", "CBSE", CLASSES), null);
  assert.equal(nextClass("KG 2", null, CLASSES), null);
});

test("a target the school doesn't run is not offered", () => {
  assert.equal(otherCurriculumClass("STD 3", "CBSE", ["STD 3", "STD 4"]), null);
  assert.equal(nextClass("STD 3", "CBSE", ["STD 3"]), null);
});

test("change kind", () => {
  const from = { grade: "STD 3", curriculum: "CBSE" as const };
  assert.equal(classChangeKind(from, { grade: "STAGE 3", curriculum: "Cambridge" }, CLASSES), "curriculum");
  assert.equal(classChangeKind(from, { grade: "STD 4", curriculum: "CBSE" }, CLASSES), "next_class");
  assert.equal(classChangeKind(from, { grade: "STD 6", curriculum: "CBSE" }, CLASSES), "other");
});

test("describe and resolve", () => {
  assert.equal(describeClass({ grade: "STAGE 3", curriculum: "Cambridge" }), "STAGE 3 (Cambridge)");
  assert.equal(describeClass({ grade: "KG 1", curriculum: null }), "KG 1");
  assert.equal(resolveCurriculum("STD 4", "Cambridge"), "CBSE"); // the class name wins
  assert.equal(resolveCurriculum("KG 2", "Cambridge"), "Cambridge");
  assert.equal(resolveCurriculum("KG 2", null), null);
});
