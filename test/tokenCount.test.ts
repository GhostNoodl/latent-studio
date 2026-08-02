import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBreak, hasBreak, estimateTokens, chunkStats, CHUNK_LIMIT } from "../frontend/src/lib/tokenCount.ts";

test("splitBreak splits on comma/newline/space-delimited BREAK", () => {
  assert.deepEqual(splitBreak("1girl, BREAK, outdoors"), ["1girl", "outdoors"]);
  assert.deepEqual(splitBreak("a\nBREAK\nb"), ["a", "b"]);
  assert.deepEqual(splitBreak("x BREAK y BREAK z"), ["x", "y", "z"]);
});

test("splitBreak returns a single chunk when no BREAK present", () => {
  assert.deepEqual(splitBreak("1girl, outdoors"), ["1girl, outdoors"]);
  assert.deepEqual(splitBreak(""), []);
});

test("hasBreak only matches the standalone uppercase word", () => {
  assert.ok(hasBreak("a BREAK b"));
  assert.ok(!hasBreak("a break b"));
  assert.ok(!hasBreak("BREAKDOWN"));
});

test("estimateTokens handles empty and single-tag prompts", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("1girl"), 2); // "1" + "girl" ≈ 2 CLIP tokens
});

test("estimateTokens strips emphasis syntax", () => {
  assert.equal(estimateTokens("(masterpiece:1.2)"), estimateTokens("masterpiece"));
  assert.equal(estimateTokens("((best quality))"), estimateTokens("best quality"));
});

test("estimateTokens is in a sane ballpark for a typical booru prompt", () => {
  const prompt =
    "masterpiece, best quality, 1girl, solo, long hair, blue eyes, school uniform, looking at viewer, smile, outdoors, cherry blossoms";
  const n = estimateTokens(prompt);
  // Real CLIP count for this is ~40; accept a wide ±25% band.
  assert.ok(n >= 30 && n <= 55, `expected 30..55, got ${n}`);
});

test("chunkStats reports per-chunk estimates and the total", () => {
  const s = chunkStats("1girl, BREAK, outdoors, sky");
  assert.equal(s.chunks.length, 2);
  assert.equal(s.total, s.chunks[0]! + s.chunks[1]!);
  assert.ok(s.chunks.every((n) => n < CHUNK_LIMIT));
});
