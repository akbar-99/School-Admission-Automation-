import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBroadwayClassName, isAutomaticBroadwayName, isKgGrade } from "./section-names";

test("KG class name carries the curriculum and the batch", () => {
  assert.equal(buildBroadwayClassName("KG 1", "A", "TULIP", "CBSE"), "CBSE KG 1-A - TULIP");
  assert.equal(buildBroadwayClassName("KG 2", "A", "bluebell", "Cambridge"), "Cambridge KG 2-A - BLUEBELL");
});

test("KG class name is blank until a curriculum is picked", () => {
  assert.equal(buildBroadwayClassName("KG 1", "A", "TULIP", ""), "");
});

test("non-KG class name has no curriculum prefix", () => {
  assert.equal(buildBroadwayClassName("STD 5", "b", "", ""), "STD 5-B");
  assert.equal(buildBroadwayClassName("stage 3", "A", "", "Cambridge"), "STAGE 3-A");
});

test("blank grade or section gives no name", () => {
  assert.equal(buildBroadwayClassName("", "A", "TULIP", "CBSE"), "");
  assert.equal(buildBroadwayClassName("KG 1", " ", "TULIP", "CBSE"), "");
});

test("a name built from an older batch still counts as automatic", () => {
  // The live case: batch is TULIP, saved Broadway name still says PANSYSY.
  assert.equal(isAutomaticBroadwayName("CBSE KG 1-A - PANSYSY", "KG 1", "A"), true);
  assert.equal(isAutomaticBroadwayName("Cambridge KG 1-A - BLUEBELL", "KG 1", "A"), true);
  assert.equal(isAutomaticBroadwayName("cbse kg 1-a - tulip", "KG 1", "A"), true);
  assert.equal(isAutomaticBroadwayName("STD 5-B", "STD 5", "B"), true);
});

test("a hand-typed or different-class name is not automatic", () => {
  assert.equal(isAutomaticBroadwayName("Tulip Morning Batch", "KG 1", "A"), false);
  assert.equal(isAutomaticBroadwayName("CBSE KG 2-A - TULIP", "KG 1", "A"), false); // other grade
  assert.equal(isAutomaticBroadwayName("KG 1-A - TULIP", "KG 1", "A"), false); // KG needs a curriculum
  assert.equal(isAutomaticBroadwayName("STD 5-A", "STD 5", "B"), false); // other section
  assert.equal(isAutomaticBroadwayName("", "KG 1", "A"), false);
});

test("grade text with regex characters is matched literally", () => {
  assert.equal(isAutomaticBroadwayName("G1.5-A", "G1.5", "A"), true);
  assert.equal(isAutomaticBroadwayName("G1x5-A", "G1.5", "A"), false);
});

test("KG detection", () => {
  assert.equal(isKgGrade("KG 1"), true);
  assert.equal(isKgGrade("kg2"), true);
  assert.equal(isKgGrade("STD 1"), false);
});
