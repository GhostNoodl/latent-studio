import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkflow } from "../shared/src/index.ts";
import type { WorkflowManifest, ParamValue } from "../shared/src/index.ts";

function manifest(
  workflow: Record<string, unknown>,
  params: WorkflowManifest["params"],
): WorkflowManifest {
  return {
    id: "t",
    name: "t",
    type: "image",
    workflow: workflow as WorkflowManifest["workflow"],
    params,
    createdAt: "",
    updatedAt: "",
  };
}

test("scalar param is injected into its node input", () => {
  const m = manifest(
    { "1": { class_type: "CLIPTextEncode", inputs: { text: "old" } } },
    [{ key: "p", label: "P", nodeId: "1", input: "text", control: "textarea", group: "simple" }],
  );
  const wf = buildWorkflow(m, { p: "new prompt" });
  assert.equal(wf["1"]!.inputs.text, "new prompt");
});

test("undefined values are left untouched", () => {
  const m = manifest(
    { "1": { class_type: "X", inputs: { text: "keep" } } },
    [{ key: "p", label: "P", nodeId: "1", input: "text", control: "textarea", group: "simple" }],
  );
  const wf = buildWorkflow(m, {});
  assert.equal(wf["1"]!.inputs.text, "keep");
});

test("the source manifest is not mutated (clone)", () => {
  const m = manifest(
    { "1": { class_type: "X", inputs: { text: "orig" } } },
    [{ key: "p", label: "P", nodeId: "1", input: "text", control: "textarea", group: "simple" }],
  );
  buildWorkflow(m, { p: "changed" });
  assert.equal(m.workflow["1"]!.inputs.text, "orig");
});

test("bypassing a toggle prunes its orphaned subgraph from the output", () => {
  const wf0 = {
    base: { class_type: "KSampler", inputs: {} },
    upscale: { class_type: "LatentUpscaleBy", inputs: { samples: ["base", 0] } },
    switch: { class_type: "LatentSwitch", inputs: { input1: ["base", 0], input2: ["upscale", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["switch", 0] } },
  };
  const m = manifest(wf0, [
    {
      key: "hires",
      label: "Hires",
      nodeId: "switch",
      input: "__enabled",
      control: "toggle",
      group: "simple",
      bypass: { nodeId: "switch", input: "input1", output: 0 },
    },
  ]);
  // OFF → switch removed, its now-orphaned upscale pruned, save rerouted to base.
  const off = buildWorkflow(m, { hires: false });
  assert.deepEqual(Object.keys(off).sort(), ["base", "save"]);
  assert.deepEqual((off.save as { inputs: { images: ParamValue } }).inputs.images, ["base", 0]);
  // ON → the full subgraph is preserved (prune removes nothing).
  const on = buildWorkflow(m, { hires: true });
  assert.deepEqual(Object.keys(on).sort(), ["base", "save", "switch", "upscale"]);
});

test("loras control rewrites Power Lora Loader lora_N dicts", () => {
  const m = manifest(
    { "1": { class_type: "Power Lora Loader (rgthree)", inputs: { lora_1: { on: true, lora: "stale", strength: 1 } } } },
    [{ key: "l", label: "LoRAs", nodeId: "1", input: "", control: "loras", group: "simple" }],
  );
  const stack: ParamValue = [
    { on: true, lora: "a.safetensors", strength: 0.8 },
    { on: false, lora: "b.safetensors", strength: 1.1 },
  ];
  const wf = buildWorkflow(m, { l: stack });
  assert.deepEqual(wf["1"]!.inputs.lora_1, { on: true, lora: "a.safetensors", strength: 0.8 });
  assert.deepEqual(wf["1"]!.inputs.lora_2, { on: false, lora: "b.safetensors", strength: 1.1 });
});

test("bypass toggle OFF splices the node and rewires its consumer", () => {
  // node 2 (hires) sits between node 1 (source) and node 3 (consumer).
  const m = manifest(
    {
      "1": { class_type: "Src", inputs: {} },
      "2": { class_type: "Hires", inputs: { image: ["1", 0] } },
      "3": { class_type: "Save", inputs: { images: ["2", 0] } },
    },
    [
      {
        key: "hires",
        label: "Hires",
        nodeId: "2",
        input: "image",
        control: "toggle",
        group: "simple",
        bypass: { nodeId: "2", input: "image", output: 0 },
      },
    ],
  );
  const off = buildWorkflow(m, { hires: false });
  assert.equal(off["2"], undefined, "node 2 removed");
  assert.deepEqual(off["3"]!.inputs.images, ["1", 0], "consumer rewired to node 1");

  const on = buildWorkflow(m, { hires: true });
  assert.ok(on["2"], "node 2 kept when toggle on");
  assert.deepEqual(on["3"]!.inputs.images, ["2", 0]);
});

test("multi-link bypass reroutes both ControlNet conditioning outputs", () => {
  // node 6 (ControlNetApplyAdvanced) takes positive [4,0] + negative [5,0] and its
  // two outputs feed the sampler; OFF must rewire each sampler input to its source.
  const m = manifest(
    {
      "4": { class_type: "CLIPTextEncode", inputs: { text: "pos" } },
      "5": { class_type: "CLIPTextEncode", inputs: { text: "neg" } },
      "6": {
        class_type: "ControlNetApplyAdvanced",
        inputs: { positive: ["4", 0], negative: ["5", 0], control_net: ["9", 0], image: ["8", 0] },
      },
      "7": { class_type: "KSampler", inputs: { positive: ["6", 0], negative: ["6", 1] } },
    },
    [
      {
        key: "cn",
        label: "Enable ControlNet",
        nodeId: "6",
        input: "__enabled",
        control: "toggle",
        group: "simple",
        bypass: {
          nodeId: "6",
          links: [
            { input: "positive", output: 0 },
            { input: "negative", output: 1 },
          ],
        },
      },
    ],
  );
  const off = buildWorkflow(m, { cn: false });
  assert.equal(off["6"], undefined, "CN apply node removed");
  assert.deepEqual(off["7"]!.inputs.positive, ["4", 0], "sampler positive → positive source");
  assert.deepEqual(off["7"]!.inputs.negative, ["5", 0], "sampler negative → negative source");

  const on = buildWorkflow(m, { cn: true });
  assert.ok(on["6"], "CN apply node kept when toggle on");
  assert.deepEqual(on["7"]!.inputs.positive, ["6", 0]);
  assert.deepEqual(on["7"]!.inputs.negative, ["6", 1]);
});

test("regional toggle OFF reverts the sampler positive to the base prompt", () => {
  // final ConditioningCombine layers regions (cond_2) onto base (cond_1); OFF must
  // splice it out and route the sampler's positive back to the base (conditioning_1).
  const m = manifest(
    {
      "4": { class_type: "CLIPTextEncode", inputs: { text: "base" } },
      "10": { class_type: "ConditioningSetMask", inputs: { conditioning: ["9", 0] } },
      "60": {
        class_type: "ConditioningCombine",
        inputs: { conditioning_1: ["4", 0], conditioning_2: ["10", 0] },
        _meta: { title: "Regional" },
      },
      "12": { class_type: "KSampler", inputs: { positive: ["60", 0] } },
    },
    [
      {
        key: "reg",
        label: "Enable Regional Prompts",
        nodeId: "60",
        input: "__enabled",
        control: "toggle",
        group: "simple",
        bypass: { nodeId: "60", input: "conditioning_1", output: 0 },
      },
    ],
  );
  const off = buildWorkflow(m, { reg: false });
  assert.equal(off["60"], undefined, "final combine removed");
  assert.deepEqual(off["12"]!.inputs.positive, ["4", 0], "sampler positive → base prompt");

  const on = buildWorkflow(m, { reg: true });
  assert.ok(on["60"], "final combine kept when toggle on");
  assert.deepEqual(on["12"]!.inputs.positive, ["60", 0]);
});
