import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidScore, scoreEntriesFromForm, subjectsMissingScores } from "./result-scores";

test("a score must be filled in, between 0 and the maximum", () => {
  assert.equal(isValidScore("", "100"), false);
  assert.equal(isValidScore("   ", "100"), false);
  assert.equal(isValidScore("0", "100"), true);
  assert.equal(isValidScore("100", "100"), true);
  assert.equal(isValidScore("101", "100"), false);
  assert.equal(isValidScore("-1", "100"), false);
  assert.equal(isValidScore("abc", "100"), false);
  assert.equal(isValidScore("45", "50"), true);
  assert.equal(isValidScore("55", "50"), false);
});

test("a blank or invalid maximum counts as 100, like the server", () => {
  assert.equal(isValidScore("90", ""), true);
  assert.equal(isValidScore("90", "0"), true);
  assert.equal(isValidScore("150", "-5"), false);
});

test("lists the subjects still missing a score, in form order", () => {
  const form: Record<string, string> = {
    subject_count: "3",
    subject_0: "Maths", score_0: "78", max_0: "100",
    subject_1: "English", score_1: "", max_1: "100",
    subject_2: "Science", score_2: "60", max_2: "50",
  };
  const entries = scoreEntriesFromForm((n) => form[n] ?? null);
  assert.deepEqual(subjectsMissingScores(entries), ["English", "Science"]);
});

test("no subjects configured means nothing is required", () => {
  assert.deepEqual(subjectsMissingScores(scoreEntriesFromForm((n) => (n === "subject_count" ? "0" : null))), []);
});

test("all scores filled -> nothing missing", () => {
  const form: Record<string, string> = {
    subject_count: "2", subject_0: "Maths", score_0: "80", max_0: "100", subject_1: "English", score_1: "0", max_1: "100",
  };
  assert.deepEqual(subjectsMissingScores(scoreEntriesFromForm((n) => form[n] ?? null)), []);
});
