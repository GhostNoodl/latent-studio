import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustWeight, insertToken } from "../frontend/src/lib/promptEdit.ts";

test("adjustWeight wraps a plain selection at 1.1", () => {
  const r = adjustWeight("1girl", 0, 5, 0.1);
  assert.equal(r.text, "(1girl:1.1)");
  assert.deepEqual([r.selStart, r.selEnd], [0, 11]);
});

test("adjustWeight bumps an existing weight", () => {
  assert.equal(adjustWeight("(1girl:1.1)", 0, 11, 0.1).text, "(1girl:1.2)");
});

test("adjustWeight unwraps back to bare text at neutral 1.0", () => {
  assert.equal(adjustWeight("(1girl:1.1)", 0, 11, -0.1).text, "1girl");
});

test("adjustWeight clamps to the ceiling of 2.0", () => {
  assert.equal(adjustWeight("(x:2.0)", 0, 7, 0.1).text, "(x:2.0)");
});

test("adjustWeight hits floor 0.0 and stays wrapped (only 1.0 unwraps)", () => {
  const r = adjustWeight("(x:0.1)", 0, 7, -0.2); // 0.1 - 0.2 -> clamp 0.0
  assert.equal(r.text, "(x:0.0)");
});

test("adjustWeight with an empty selection expands to the token at the caret", () => {
  // caret at index 15 sits inside "1girl" (13..18) of "masterpiece, 1girl"
  const r = adjustWeight("masterpiece, 1girl", 15, 15, 0.1);
  assert.equal(r.text, "masterpiece, (1girl:1.1)");
});

test("adjustWeight on empty text is a no-op", () => {
  const r = adjustWeight("", 0, 0, 0.1);
  assert.equal(r.text, "");
});

test("insertToken inserts at caret in empty text", () => {
  assert.equal(insertToken("", 0, 0, "embedding:x").text, "embedding:x");
});

test("insertToken adds a comma separator before adjacent text", () => {
  const r = insertToken("a, b", 4, 4, "c"); // caret at end, prev char "b"
  assert.equal(r.text, "a, b, c");
});

test("insertToken replacing a selection reuses existing separators", () => {
  const r = insertToken("a, OLD, b", 3, 6, "NEW"); // left ends ", ", right starts ","
  assert.equal(r.text, "a, NEW, b");
});

test("insertToken caret lands after the inserted token", () => {
  const r = insertToken("a, b", 4, 4, "c");
  assert.equal(r.text.slice(0, r.selStart), "a, b, c");
});
