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

test("dropInput toggle OFF removes an optional link and prunes its feeder (audio off)", () => {
  // LTX audio: node 43 (decoder) feeds CreateVideo's OPTIONAL audio input. OFF must
  // delete that link (not reroute) — the decoder is then orphaned and pruned, while
  // the shared audio VAE (17) survives because node 16 still needs it.
  const m = manifest(
    {
      "17": { class_type: "LTXVAudioVAELoader", inputs: { ckpt_name: "av.safetensors" } },
      "16": { class_type: "LTXVEmptyLatentAudio", inputs: { audio_vae: ["17", 0] } },
      "41": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["16", 0] } },
      "43": { class_type: "LTXVAudioVAEDecode", inputs: { samples: ["41", 1], audio_vae: ["17", 0] } },
      "44": { class_type: "CreateVideo", inputs: { images: ["41", 0], fps: 24, audio: ["43", 0] } },
    },
    [
      {
        key: "audio",
        label: "Enable Audio",
        nodeId: "43",
        input: "__enabled",
        control: "toggle",
        group: "simple",
        dropInput: { nodeId: "44", input: "audio" },
      },
    ],
  );
  const off = buildWorkflow(m, { audio: false });
  assert.equal(off["44"]!.inputs.audio, undefined, "audio link dropped");
  assert.equal(off["43"], undefined, "decoder pruned");
  assert.ok(off["17"], "shared audio VAE kept (still feeds node 16)");

  const on = buildWorkflow(m, { audio: true });
  assert.deepEqual(on["44"]!.inputs.audio, ["43", 0], "audio link kept when toggle on");
  assert.ok(on["43"], "decoder kept when toggle on");
});

// ── MiniMax H3 pipeline ─────────────────────────────────────────────────────

/** Compact stand-in for the H3 I2V graph: same shapes, same link topology. */
function h3Manifest(): WorkflowManifest {
  return manifest(
    {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "h3.safetensors", weight_dtype: "default" } },
      "3": { class_type: "VAELoader", inputs: { vae_name: "video_vae.safetensors" } },
      "4": { class_type: "VAELoader", inputs: { vae_name: "audio_vae.safetensors" } },
      "5": {
        class_type: "MiniMaxH3ImageToVideo",
        inputs: { clip: ["2", 0], vae: ["3", 0], first_frame: ["20", 0], prompt: "", width: ["6", 0], length: 124 },
        _meta: { title: "MiniMax H3" },
      },
      "6": { class_type: "PrimitiveInt", inputs: { value: 1344 }, _meta: { title: "Width" } },
      "10": { class_type: "RandomNoise", inputs: { noise_seed: 1 }, _meta: { title: "Seed" } },
      "15": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["10", 0], latent_image: ["5", 1] } },
      "16": { class_type: "VAEDecode", inputs: { samples: ["15", 0], vae: ["3", 0] } },
      "17": { class_type: "VAEDecodeAudio", inputs: { samples: ["15", 0], vae: ["4", 0] } },
      "18": { class_type: "CreateVideo", inputs: { images: ["16", 0], fps: 24, audio: ["17", 0] } },
      "19": { class_type: "SaveVideo", inputs: { video: ["18", 0] } },
      "20": { class_type: "LoadImage", inputs: { image: "region_blank.png" }, _meta: { title: "Start image" } },
      "21": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "h3_turbo.safetensors", strength_model: 1 } },
      "22": { class_type: "PrimitiveBoolean", inputs: { value: false }, _meta: { title: "Turbo LoRA (euler/beta, 8 steps)" } },
      "23": { class_type: "LazySwitchKJ", inputs: { switch: ["22", 0], on_false: ["1", 0], on_true: ["21", 0] } },
    },
    [
      { key: "prompt", label: "Prompt", nodeId: "5", input: "prompt", control: "textarea", group: "simple" },
      { key: "width", label: "Width", nodeId: "6", input: "value", control: "number", group: "simple" },
      { key: "seed", label: "Seed", nodeId: "10", input: "noise_seed", control: "seed", group: "simple" },
      { key: "img", label: "Start image", nodeId: "20", input: "image", control: "image", group: "simple" },
      { key: "turbo", label: "Turbo LoRA (euler/beta, 8 steps)", nodeId: "22", input: "value", control: "toggle", group: "simple" },
      { key: "lora", label: "Turbo LoRA (4-step distill)", nodeId: "21", input: "lora_name", control: "select", modelKind: "lora", group: "advanced" },
      {
        key: "audio",
        label: "Enable Audio",
        nodeId: "17",
        input: "__enabled",
        control: "toggle",
        group: "simple",
        dropInput: { nodeId: "18", input: "audio" },
      },
    ],
  );
}

test("H3: scalars + start image inject into their node inputs", () => {
  const wf = buildWorkflow(h3Manifest(), {
    prompt: "a cat playing piano, soft jazz",
    width: 864,
    seed: 123,
    img: "cat.png",
  });
  assert.equal(wf["5"]!.inputs.prompt, "a cat playing piano, soft jazz");
  assert.equal(wf["6"]!.inputs.value, 864);
  assert.equal(wf["10"]!.inputs.noise_seed, 123);
  assert.equal(wf["20"]!.inputs.image, "cat.png");
  // Untouched links survive intact.
  assert.deepEqual(wf["5"]!.inputs.first_frame, ["20", 0]);
  assert.deepEqual(wf["18"]!.inputs.audio, ["17", 0]);
});

test("H3: audio toggle OFF drops CreateVideo.audio and prunes the audio decode + its VAE", () => {
  const off = buildWorkflow(h3Manifest(), { audio: false });
  assert.equal(off["18"]!.inputs.audio, undefined, "audio link dropped");
  assert.equal(off["17"], undefined, "audio decode pruned");
  assert.equal(off["4"], undefined, "audio VAE pruned (only fed the decoder)");
  for (const id of ["1", "3", "5", "6", "10", "15", "16", "18", "19", "20"]) {
    assert.ok(off[id], `${id} kept`);
  }

  const on = buildWorkflow(h3Manifest(), { audio: true });
  assert.deepEqual(on["18"]!.inputs.audio, ["17", 0], "audio link kept when toggle on");
  assert.ok(on["17"] && on["4"], "audio decode + VAE kept when toggle on");
});

test("H3: turbo toggle injects into the PrimitiveBoolean driving the LazySwitchKJ nodes", () => {
  const on = buildWorkflow(h3Manifest(), { turbo: true });
  assert.equal(on["22"]!.inputs.value, true, "turbo switch on");
  const off = buildWorkflow(h3Manifest(), { turbo: false });
  assert.equal(off["22"]!.inputs.value, false, "turbo switch off");
  // Switch topology is static — the boolean picks the branch at execution time.
  for (const wf of [on, off]) {
    assert.deepEqual(wf["23"]!.inputs.switch, ["22", 0]);
    assert.deepEqual(wf["23"]!.inputs.on_true, ["21", 0], "lora branch on_true");
    assert.deepEqual(wf["23"]!.inputs.on_false, ["1", 0], "clean model on_false");
  }
});

// ── BREAK chunking ──────────────────────────────────────────────────────────

function breakManifest(): WorkflowManifest {
  return manifest(
    {
      "4": { class_type: "CLIPTextEncode", inputs: { text: "old", clip: ["1", 1] } },
      "12": { class_type: "KSampler", inputs: { positive: ["4", 0] } },
    },
    [{ key: "p", label: "P", nodeId: "4", input: "text", control: "textarea", group: "simple" }],
  );
}

test("BREAK splits a prompt into per-chunk encodes joined by ConditioningConcat", () => {
  const wf = buildWorkflow(breakManifest(), { p: "1girl, BREAK, outdoors" });
  assert.equal(wf["4"]!.inputs.text, "1girl");
  assert.equal(wf["4__brk1"]!.inputs.text, "outdoors");
  assert.equal(wf["4__brk1"]!.class_type, "CLIPTextEncode");
  assert.deepEqual(wf["4__brk1"]!.inputs.clip, ["1", 1], "clone keeps the clip link");
  assert.equal(wf["4__cat1"]!.class_type, "ConditioningConcat");
  assert.deepEqual(wf["4__cat1"]!.inputs.conditioning_to, ["4", 0]);
  assert.deepEqual(wf["4__cat1"]!.inputs.conditioning_from, ["4__brk1", 0]);
  assert.deepEqual(wf["12"]!.inputs.positive, ["4__cat1", 0], "sampler rerouted to concat tail");
});

test("three BREAK chunks chain two concats; newline-delimited BREAK works", () => {
  const wf = buildWorkflow(breakManifest(), { p: "a\nBREAK\nb, BREAK, c" });
  assert.equal(wf["4"]!.inputs.text, "a");
  assert.equal(wf["4__brk1"]!.inputs.text, "b");
  assert.equal(wf["4__brk2"]!.inputs.text, "c");
  assert.deepEqual(wf["4__cat2"]!.inputs.conditioning_to, ["4__cat1", 0]);
  assert.deepEqual(wf["4__cat2"]!.inputs.conditioning_from, ["4__brk2", 0]);
  assert.deepEqual(wf["12"]!.inputs.positive, ["4__cat2", 0]);
});

test("BREAK with a single non-empty chunk just strips the token", () => {
  const wf = buildWorkflow(breakManifest(), { p: "BREAK, only this" });
  assert.equal(wf["4"]!.inputs.text, "only this");
  assert.deepEqual(Object.keys(wf).sort(), ["12", "4"], "no extra nodes");
  assert.deepEqual(wf["12"]!.inputs.positive, ["4", 0]);
});

test("BREAK nodes survive orphan pruning (reachable through the concat chain)", () => {
  const wf = buildWorkflow(breakManifest(), { p: "x BREAK y BREAK z" });
  for (const id of ["4", "4__brk1", "4__brk2", "4__cat1", "4__cat2", "12"]) {
    assert.ok(wf[id], `${id} kept`);
  }
});

test("BREAK in a non-TextEncode textarea is written verbatim", () => {
  const m = manifest(
    { "1": { class_type: "StringConstant", inputs: { string: "old" } } },
    [{ key: "p", label: "P", nodeId: "1", input: "string", control: "textarea", group: "simple" }],
  );
  const wf = buildWorkflow(m, { p: "a BREAK b" });
  assert.equal(wf["1"]!.inputs.string, "a BREAK b");
  assert.deepEqual(Object.keys(wf), ["1"]);
});
