import test from "node:test";
import assert from "node:assert/strict";
import type { WorkflowManifest } from "@latent/shared";
import { applyGenerationPreset } from "../backend/src/generation-presets.ts";

const image = {
  id: "image",
  name: "Image",
  type: "image",
  workflow: {
    base: { class_type: "KSampler", inputs: {}, _meta: { title: "Sampler" } },
    hires: { class_type: "KSampler", inputs: {}, _meta: { title: "Hires Fix" } },
    face: { class_type: "FaceDetailer", inputs: {}, _meta: { title: "Face Detailer" } },
  },
  params: [
    { key: "base.steps", label: "Steps", nodeId: "base", input: "steps", control: "number", group: "simple", default: 20 },
    { key: "hires.on", label: "Enable Hires Fix", nodeId: "hires", input: "__enabled", control: "toggle", group: "simple", section: "Hires Fix", default: false },
    { key: "hires.steps", label: "Steps", nodeId: "hires", input: "steps", control: "number", group: "simple", section: "Hires Fix", default: 15 },
    { key: "face.on", label: "Enable Face Detailer", nodeId: "face", input: "__enabled", control: "toggle", group: "simple", section: "Face Detailer", default: false },
  ],
  createdAt: "now",
  updatedAt: "now",
} satisfies WorkflowManifest;

test("image draft caps base sampling and skips expensive finishing", () => {
  const source = { "base.steps": 30, "hires.on": true, "hires.steps": 18, "face.on": true };
  const result = applyGenerationPreset(image, source, "draft");
  assert.deepEqual(result, { "base.steps": 14, "hires.on": false, "hires.steps": 18, "face.on": false });
  assert.equal(source["base.steps"], 30);
});

test("image custom is untouched and final enables available finishing", () => {
  const source = { "base.steps": 24, "hires.on": false, "face.on": false };
  assert.deepEqual(applyGenerationPreset(image, source, undefined), source);
  assert.deepEqual(applyGenerationPreset(image, source, "final"), {
    "base.steps": 24,
    "hires.on": true,
    "face.on": true,
  });
});

test("H3 draft creates a short low-resolution silent turbo proof", () => {
  const manifest = {
    ...image,
    id: "h3",
    name: "MiniMax H3 — txt2vid",
    type: "video",
    baseGroup: "MiniMax H3",
    workflow: {},
    params: [
      { key: "w", label: "Width", nodeId: "1", input: "value", control: "number", group: "simple", default: 1344 },
      { key: "h", label: "Height", nodeId: "2", input: "value", control: "number", group: "simple", default: 768 },
      { key: "d", label: "Duration (s)", nodeId: "3", input: "value", control: "number", group: "simple", default: 5 },
      { key: "audio", label: "Enable Audio", nodeId: "4", input: "__enabled", control: "toggle", group: "simple", default: true },
      { key: "turbo", label: "Turbo LoRA (4 steps)", nodeId: "5", input: "value", control: "toggle", group: "simple", default: false },
    ],
  } satisfies WorkflowManifest;
  const result = applyGenerationPreset(manifest, {}, "draft");
  assert.deepEqual(result, { w: 864, h: 480, d: 2, audio: false, turbo: true });
  assert.equal(applyGenerationPreset(manifest, {}, "final").turbo, false);
});
