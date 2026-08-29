import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate from the real data dir BEFORE importing the assistant (config.ts
// resolves DATA_DIR at module load; tags/wildcards then degrade to empty).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "latent-pa-test-"));

const { buildSystemPrompt, isHomoFidelis, isKrea2, isMiniMaxH3, isMiniMaxMusic3 } = await import(
  "../backend/src/prompt-assistant.ts"
);

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

test("Krea 2 image pipelines get natural-language briefs without booru grounding", () => {
  const sys = buildSystemPrompt({
    pipelineType: "image",
    pipelineGroup: "Krea 2",
    pipelineName: "Krea 2 — txt2img (Turbo FP8)",
    positive: "A red fox astronaut inside a glass greenhouse",
    imageRef: "source.png",
  });
  assert.equal(isKrea2({ pipelineType: "image", pipelineGroup: "Krea 2" }), true);
  assert.match(sys, /rich natural-language descriptions/);
  assert.match(sys, /guidance-free sampling/);
  assert.match(sys, /A red fox astronaut inside a glass greenhouse/);
  assert.match(sys, /Describe requested edits in natural language/);
  assert.doesNotMatch(sys, /danbooru\/e621 tags/);
  assert.doesNotMatch(sys, /VALID TAG VOCABULARY/);
});

test("Krea 2 pipeline name prefix selects its dialect when group metadata is absent", () => {
  assert.equal(isKrea2({ pipelineType: "image", pipelineName: "Krea 2 — custom" }), true);
  assert.equal(isKrea2({ pipelineType: "image", pipelineName: "Image — Smooth v4" }), false);
});

test("HomoFidelis gets its concise adult Krea 2 model profile", () => {
  const seed = {
    pipelineType: "image" as const,
    pipelineGroup: "Krea 2",
    pipelineName: "Krea 2 — txt2img (Turbo FP8)",
    model: "homofidelisKrea2NSFW_v10TURBOINT8Convrot.safetensors",
  };
  const sys = buildSystemPrompt(seed);
  assert.equal(isHomoFidelis(seed), true);
  assert.match(sys, /adult-oriented, male-focused/);
  assert.match(sys, /concise, literal sentences/);
  assert.match(sys, /There is no negative prompt at CFG 1/);
  assert.doesNotMatch(sys, /VALID TAG VOCABULARY/);
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

test("MiniMax Music 3 gets separate caption and tagged-lyrics guidance", () => {
  const sys = buildSystemPrompt({
    pipelineType: "audio",
    pipelineGroup: "MiniMax Music 3",
    pipelineName: "MiniMax Music 3 — text to music",
    caption: "Global Metadata: synth-pop",
    lyrics: "[Chorus]\nStay awake",
  });
  assert.equal(isMiniMaxMusic3({ pipelineType: "audio" }), true);
  assert.match(sys, /Song Studio/);
  assert.match(sys, /Global Metadata, Vocal Details, Arrangement/);
  assert.match(sys, /\[Verse\]/);
  assert.match(sys, /Caption:\nGlobal Metadata: synth-pop/);
  assert.match(sys, /Lyrics:\n\[Chorus\]\nStay awake/);
  assert.doesNotMatch(sys, /danbooru\/e621 tags/);
});
