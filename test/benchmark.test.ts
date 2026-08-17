import test from "node:test";
import assert from "node:assert/strict";
import { median, parseArgs, summarize } from "../scripts/benchmark.mjs";

test("benchmark parser is a safe dry run unless explicitly armed", () => {
  const parsed = parseArgs(["--source", "abc", "--presets", "custom,draft", "--runs", "3"]);
  assert.equal(parsed.run, false);
  assert.deepEqual(parsed.presets, ["custom", "draft"]);
  assert.equal(parsed.runs, 3);
  assert.throws(() => parseArgs(["--runs", "0"]), /1-20/);
});

test("benchmark summaries use medians per preset", () => {
  assert.equal(median([9, 1, 5, 3]), 4);
  const rows = summarize([
    { preset: "draft", record: { performance: { totalMs: 100, executionMs: 80, queueMs: 10, outputMs: 5 } } },
    { preset: "draft", record: { performance: { totalMs: 300, executionMs: 240, queueMs: 20, outputMs: 7 } } },
    { preset: "final", record: { performance: { totalMs: 1000, executionMs: 900, queueMs: 30, outputMs: 9 } } },
  ]);
  assert.deepEqual(rows[0], { preset: "draft", runs: 2, totalMs: 200, executionMs: 160, queueMs: 15, outputMs: 6 });
});
