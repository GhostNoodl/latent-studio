import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate from the real data dir BEFORE importing the assistant (config.ts
// resolves DATA_DIR at module load; tags/wildcards then degrade to empty).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "latent-pa-test-"));

const { buildSystemPrompt, isMiniMaxH3 } = await import("../backend/src/prompt-assistant.ts");

test("MiniMax H3 pipelines get the H3 brief dialect", () => {
  const sys = buildSystemPrompt({
    pipelineType: "video",
    pipelineGroup: "MiniMax H3",
    pipelineName: "MiniMax H3 — txt2vid",
  });
  assert.match(sys, /MiniMax H3/);
  assert.match(sys, /Audio:/); // same-pass stereo audio is a first-class block
  assert.match(sys, /\[0s-2s\]/); // timed-beat timeline convention
  // Not the LTX dialect, not booru tags.
  assert.doesNotMatch(sys, /LTX 2\.3/);
  assert.doesNotMatch(sys, /danbooru\/e621 tags/);
});

test("pipelineName prefix detects H3 without a group (renamed/imported pipelines)", () => {
  assert.equal(isMiniMaxH3({ pipelineType: "video", pipelineName: "MiniMax H3 — img2vid" }), true);
  assert.equal(isMiniMaxH3({ pipelineType: "video", pipelineGroup: "MiniMax H3" }), true);
  assert.equal(isMiniMaxH3({ pipelineType: "video", pipelineName: "LTX 2.3 — img2vid (Sulphur)" }), false);
});

test("LTX video pipelines keep the LTX prose dialect", () => {
  const sys = buildSystemPrompt({
    pipelineType: "video",
    pipelineGroup: "LTX 2.3",
    pipelineName: "LTX 2.3 — img2vid (Sulphur)",
  });
  assert.match(sys, /LTX 2\.3/);
  assert.doesNotMatch(sys, /MiniMax H3/);
});

test("image pipelines keep the booru tag dialect", () => {
  const sys = buildSystemPrompt({ pipelineType: "image", pipelineName: "Image — Smooth v4" });
  assert.match(sys, /danbooru\/e621 tags/);
  assert.doesNotMatch(sys, /MiniMax H3/);
});

test("H3 seed still carries pipeline name + current prompt into the system message", () => {
  const sys = buildSystemPrompt({
    pipelineType: "video",
    pipelineGroup: "MiniMax H3",
    pipelineName: "MiniMax H3 — txt2vid",
    positive: "a cat on a windowsill",
  });
  assert.match(sys, /CURRENT PIPELINE: MiniMax H3 — txt2vid/);
  assert.match(sys, /a cat on a windowsill/);
});
