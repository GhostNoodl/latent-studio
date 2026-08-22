import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkflow, INLINE_REGION_LIMIT, parseInlineRegions, type WorkflowManifest } from "@latent/shared";

const now = "2026-08-20T00:00:00.000Z";
function regionalManifest(): WorkflowManifest {
  return {
    id: "inline-regions", name: "Inline regions", type: "image",
    workflow: {
      "1": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["3", 1] }, _meta: { title: "Positive Prompt" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "bad", clip: ["3", 1] }, _meta: { title: "Negative Prompt" } },
      "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } },
      "1011": { class_type: "CLIPTextEncode", inputs: { text: "manual", clip: ["3", 1] }, _meta: { title: "Region 1" } },
      "1014": { class_type: "ConditioningSetMask", inputs: { conditioning: ["1011", 0], mask: ["1012", 0], strength: 1 } },
      "1012": { class_type: "LoadImageMask", inputs: { image: "region_blank.png", channel: "red" } },
      "1060": { class_type: "ConditioningCombine", inputs: { conditioning_1: ["1", 0], conditioning_2: ["1014", 0] }, _meta: { title: "Regional" } },
      "12": { class_type: "KSampler", inputs: { model: ["3", 0], positive: ["1060", 0], negative: ["2", 0], latent_image: ["13", 0] } },
      "13": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    },
    params: [
      { key: "prompt", label: "Positive Prompt", nodeId: "1", input: "text", control: "textarea", group: "simple", default: "" },
      { key: "regional", label: "Enable Regional Prompts", nodeId: "1060", input: "__enabled", control: "toggle", group: "simple", default: false, bypass: { nodeId: "1060", input: "conditioning_1", output: 0 } },
    ],
    createdAt: now, updatedAt: now,
  };
}

test("named REGION lines are removed from the base prompt and normalized", () => {
  const parsed = parseInlineRegions("two characters in a cafe\n\nREGION(left, 1.2): orange fox\nREGION(right): blue wolf");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.basePrompt, "two characters in a cafe");
  assert.deepEqual(parsed.regions.map(({ name, strength }) => ({ name, strength })), [
    { name: "left", strength: 1.2 }, { name: "right", strength: 1 },
  ]);
});

test("custom percentage regions validate their bounds", () => {
  const valid = parseInlineRegions("scene\nREGION(10%, 20%, 35%, 40%, 0.75): subject");
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.regions[0], { line: 2, name: "custom 1", prompt: "subject", x: 0.1, y: 0.2, width: 0.35, height: 0.4, strength: 0.75 });
  assert.match(parseInlineRegions("REGION(80%, 0%, 30%, 100%): outside").errors[0]?.message ?? "", /fit inside/i);
});

test("inline region syntax reports malformed directives and enforces the limit", () => {
  assert.match(parseInlineRegions("prompt REGION(left): fox").errors[0]?.message ?? "", /own line/i);
  assert.match(parseInlineRegions("REGION(middle): fox").errors[0]?.message ?? "", /unknown region/i);
  const tooMany = parseInlineRegions(Array.from({ length: INLINE_REGION_LIMIT + 1 }, (_, index) => `REGION(left): subject ${index}`).join("\n"));
  assert.equal(tooMany.regions.length, INLINE_REGION_LIMIT);
  assert.match(tooMany.errors.at(-1)?.message ?? "", /at most 8/i);
});

test("buildWorkflow compiles inline regions and preserves BREAK", () => {
  const workflow = buildWorkflow(regionalManifest(), {
    prompt: "global one BREAK global two\nREGION(center): region one BREAK region two",
    regional: false,
  });
  assert.equal(workflow["1__cat1"]?.class_type, "ConditioningConcat");
  assert.equal(workflow["1__inlineRegion1_cat1"]?.class_type, "ConditioningConcat");
  assert.equal(workflow["1__inlineRegion1_area"]?.class_type, "ConditioningSetAreaPercentage");
  assert.deepEqual(workflow["12"]?.inputs.positive, ["1__inlineRegion1_combine", 0]);
  assert.equal(workflow["1060"], undefined);
});

test("invalid inline syntax blocks workflow submission", () => {
  assert.throws(() => buildWorkflow(regionalManifest(), { prompt: "scene\nREGION(left) fox", regional: false }), /Invalid inline regional prompt.*line 2/i);
});
