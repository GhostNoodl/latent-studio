import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ComfyWorkflow, ObjectInfo, WorkflowManifest } from "@latent/shared";
import { buildWorkflow } from "@latent/shared";
import { BUNDLED_PIPELINES } from "../backend/src/bundled-pipelines.ts";
import { buildManifestParams } from "../backend/src/manifest-builder.ts";
import { STARTER_MODELS } from "../backend/src/starter-models.ts";

const workflow = JSON.parse(
  readFileSync(new URL("../workflows/Krea 2 Turbo T2I API.json", import.meta.url), "utf8"),
) as ComfyWorkflow;

test("bundled Krea 2 workflow uses the official Turbo FP8 model pack", () => {
  assert.equal(workflow["1"]?.class_type, "UNETLoader");
  assert.equal(workflow["1"]?.inputs.unet_name, "krea2_turbo_fp8_scaled.safetensors");
  assert.equal(workflow["2"]?.class_type, "CLIPLoader");
  assert.equal(workflow["2"]?.inputs.clip_name, "qwen3vl_4b_fp8_scaled.safetensors");
  assert.equal(workflow["2"]?.inputs.type, "krea2");
  assert.equal(workflow["3"]?.inputs.vae_name, "qwen_image_vae.safetensors");
});

test("bundled Krea 2 workflow preserves Turbo sampling semantics", () => {
  const sampler = workflow["7"];
  assert.equal(sampler?.class_type, "KSampler");
  assert.equal(sampler?.inputs.steps, 8);
  assert.equal(sampler?.inputs.cfg, 1);
  assert.equal(sampler?.inputs.sampler_name, "euler");
  assert.equal(sampler?.inputs.scheduler, "simple");
  assert.equal(sampler?.inputs.denoise, 1);
  assert.equal(workflow["5"]?.class_type, "ConditioningZeroOut");
  assert.deepEqual(sampler?.inputs.negative, ["5", 0]);
  assert.equal(
    Object.values(workflow).some(
      (node) => node.class_type === "CLIPTextEncode" && /negative/i.test(node._meta?.title ?? ""),
    ),
    false,
  );
});

test("HomoFidelis runs through the standard Krea 2 graph as a model selection", () => {
  const now = "2026-08-23T00:00:00.000Z";
  const manifest: WorkflowManifest = {
    id: "krea2-homofidelis-test",
    name: "Krea 2 — txt2img (Turbo FP8)",
    type: "image",
    workflow,
    params: [
      {
        key: "model",
        label: "Krea 2 model",
        nodeId: "1",
        input: "unet_name",
        control: "select",
        group: "simple",
        modelKind: "diffusion",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const built = buildWorkflow(manifest, {
    model: "homofidelisKrea2NSFW_v10TURBOINT8Convrot.safetensors",
  });

  assert.equal(
    built["1"]?.inputs.unet_name,
    "homofidelisKrea2NSFW_v10TURBOINT8Convrot.safetensors",
  );
  assert.equal(built["2"]?.inputs.clip_name, workflow["2"]?.inputs.clip_name);
  assert.equal(built["2"]?.inputs.type, "krea2");
  assert.equal(built["3"]?.inputs.vae_name, workflow["3"]?.inputs.vae_name);
  assert.equal(built["7"]?.inputs.steps, 8);
  assert.equal(built["7"]?.inputs.cfg, 1);
  assert.equal(built["5"]?.class_type, "ConditioningZeroOut");
});

test("Latent injects Krea prompt, resolution, and seed without changing safe defaults", () => {
  const now = "2026-08-23T00:00:00.000Z";
  const manifest: WorkflowManifest = {
    id: "krea2-test",
    name: "Krea 2 test",
    type: "image",
    workflow,
    params: [
      { key: "prompt", label: "Prompt", nodeId: "4", input: "text", control: "textarea", group: "simple" },
      { key: "width", label: "Width", nodeId: "6", input: "width", control: "number", group: "simple" },
      { key: "height", label: "Height", nodeId: "6", input: "height", control: "number", group: "simple" },
      { key: "seed", label: "Seed", nodeId: "7", input: "seed", control: "seed", group: "simple" },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const built = buildWorkflow(manifest, {
    prompt: "a charcoal drawing of a fox in snowfall",
    width: 1216,
    height: 832,
    seed: 42,
  });

  assert.equal(built["4"]?.inputs.text, "a charcoal drawing of a fox in snowfall");
  assert.equal(built["6"]?.inputs.width, 1216);
  assert.equal(built["6"]?.inputs.height, 832);
  assert.equal(built["7"]?.inputs.seed, 42);
  assert.equal(built["7"]?.inputs.steps, 8);
  assert.equal(built["7"]?.inputs.cfg, 1);
  assert.equal(built["2"]?.inputs.type, "krea2");
});

test("Krea 2 derives a focused prompt, model, resolution, and sampling control surface", () => {
  const objectInfo = {
    UNETLoader: {
      input: { required: { unet_name: [["krea2_turbo_fp8_scaled.safetensors"]], weight_dtype: [["default"]] } },
    },
    CLIPLoader: {
      input: {
        required: {
          clip_name: [["qwen3vl_4b_fp8_scaled.safetensors"]],
          type: [["krea2"]],
          device: [["default"]],
        },
      },
    },
    VAELoader: { input: { required: { vae_name: [["qwen_image_vae.safetensors"]] } } },
    CLIPTextEncode: {
      input: { required: { text: ["STRING", { multiline: true }], clip: ["CLIP"] } },
    },
    EmptyLatentImage: {
      input: {
        required: {
          width: ["INT", { min: 16, max: 16_384, step: 8 }],
          height: ["INT", { min: 16, max: 16_384, step: 8 }],
          batch_size: ["INT", { min: 1, max: 4_096 }],
        },
      },
    },
    KSampler: {
      input: {
        required: {
          seed: ["INT", { min: 0, max: Number.MAX_SAFE_INTEGER }],
          steps: ["INT", { min: 1, max: 10_000 }],
          cfg: ["FLOAT", { min: 0, max: 100, step: 0.1 }],
          sampler_name: [["euler"]],
          scheduler: [["simple"]],
          denoise: ["FLOAT", { min: 0, max: 1, step: 0.01 }],
          model: ["MODEL"],
          positive: ["CONDITIONING"],
          negative: ["CONDITIONING"],
          latent_image: ["LATENT"],
        },
      },
    },
  } as unknown as ObjectInfo;

  const params = buildManifestParams(workflow, objectInfo);
  const byKey = new Map(params.map((param) => [param.key, param]));
  assert.equal(byKey.get("4.text")?.label, "Prompt");
  assert.equal(byKey.get("4.text")?.control, "textarea");
  assert.equal(byKey.get("1.unet_name")?.modelKind, "diffusion");
  assert.equal(byKey.get("2.clip_name")?.modelKind, "text_encoder");
  assert.equal(byKey.get("3.vae_name")?.modelKind, "vae");
  assert.equal(byKey.get("6.width")?.default, 1024);
  assert.equal(byKey.get("6.height")?.default, 1024);
  assert.equal(byKey.get("7.steps")?.default, 8);
  assert.equal(byKey.get("7.cfg")?.default, 1);
  assert.equal(params.some((param) => /negative/i.test(param.label)), false);
});

test("Krea 2 is bundled and its exact downloads are integrity and license pinned", () => {
  const bundled = BUNDLED_PIPELINES.find((item) => item.file === "Krea 2 Turbo T2I API.json");
  assert.deepEqual(
    bundled && { name: bundled.name, type: bundled.type, baseGroup: bundled.baseGroup, mode: bundled.mode },
    { name: "Krea 2 — txt2img (Turbo FP8)", type: "image", baseGroup: "Krea 2", mode: "txt2img" },
  );

  const expected = new Map([
    ["krea2_turbo_fp8_scaled.safetensors", [13_141_730_784, "eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1"]],
    ["qwen3vl_4b_fp8_scaled.safetensors", [5_242_467_968, "54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094"]],
    ["qwen_image_vae.safetensors", [253_806_246, "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f"]],
  ] as const);
  const models = STARTER_MODELS.filter((item) => item.pack === "krea2");
  const official = models.filter((item) => item.id !== "homofidelis-krea2-v10-turbo-int8-convrot");
  assert.equal(official.length, 3);
  for (const model of official) {
    const pinned = expected.get(model.filename as keyof typeof expected);
    assert.ok(pinned, `unexpected Krea 2 file: ${model.filename}`);
    assert.equal(model.sizeBytes, pinned[0]);
    assert.equal(model.sha256, pinned[1]);
    assert.equal(model.recommended, true);
    assert.equal(model.license?.requiresAcceptance, true);
    assert.match(model.license?.notice ?? "", /Krea 2 is licensed under/);
    assert.match(model.source.type === "url" ? model.source.url : "", /^https:\/\/huggingface\.co\/Comfy-Org\/Krea-2\//);
  }

  const homo = models.find((item) => item.id === "homofidelis-krea2-v10-turbo-int8-convrot");
  assert.ok(homo);
  assert.equal(homo.filename, "homofidelisKrea2NSFW_v10TURBOINT8Convrot.safetensors");
  assert.equal(homo.sizeBytes, 14_132_235_024);
  assert.equal(homo.sha256, "e8554103016a626da20e5bdb28b6a4579ad7804adca1f33b01b93b2eeda98cb3");
  assert.equal(homo.kind, "diffusion");
  assert.equal(homo.folder, "DiffusionModels");
  assert.equal(homo.onboarding, false);
  assert.equal(homo.nsfw, true);
  assert.equal(homo.recommended, undefined);
  assert.equal(homo.license?.requiresAcceptance, true);
  assert.deepEqual(homo.source, { type: "civitai", modelId: 2_867_077, versionId: 3_239_084 });

  assert.deepEqual(
    bundled?.modelOptions?.diffusion,
    ["homofidelisKrea2NSFW_v10TURBOINT8Convrot.safetensors"],
  );
  assert.equal(BUNDLED_PIPELINES.some((item) => /homofidelis/i.test(item.name)), false);
});
