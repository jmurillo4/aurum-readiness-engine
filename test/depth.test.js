// test/depth.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { parseDepth, coversRange } from "../src/depth.js";

test("parseDepth: parses inches with hyphens and spaces", () => {
  assert.deepEqual(parseDepth("0-6 in"), { topIn: 0, bottomIn: 6 });
  assert.deepEqual(parseDepth("0 to 6 in"), { topIn: 0, bottomIn: 6 });
  assert.deepEqual(parseDepth('0-6"'), { topIn: 0, bottomIn: 6 });
});

test("parseDepth: converts centimeters to inches accurately", () => {
  // 15 cm / 2.54 = ~5.91 in
  assert.deepEqual(parseDepth("0-15 cm"), { topIn: 0, bottomIn: 5.91 });
  // 30 cm / 2.54 = ~11.81 in
  assert.deepEqual(parseDepth("0-30 cm"), { topIn: 0, bottomIn: 11.81 });
});

test("parseDepth: refuses to guess when units are omitted", () => {
  assert.equal(parseDepth("0-15"), null);
  assert.equal(parseDepth("0 to 6"), null);
  assert.equal(parseDepth('0 6"'), null);
  assert.equal(parseDepth("shallow"), null);
  assert.equal(parseDepth(null), null);
});

test("coversRange: checks depth bounds correctly", () => {
  const depth6in = { topIn: 0, bottomIn: 6 };
  const depth15cm = { topIn: 0, bottomIn: 5.91 };

  // Standard 0-6 inch requirement
  assert.equal(coversRange(depth6in, { min_top_in: 0, min_bottom_in: 6 }), true);

  // 15 cm is 5.91 in, so it fails a 6-inch minimum depth requirement
  assert.equal(coversRange(depth15cm, { min_top_in: 0, min_bottom_in: 6 }), false);
});