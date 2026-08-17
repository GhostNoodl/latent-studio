import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComfyWorkflow } from "@latent/shared";
import { STARTER_MODELS } from "../backend/src/starter-models.ts";

const expected = "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors";

for (const file of ["MiniMax H3 T2V API.json", "MiniMax H3 I2V API.json"]) {
  test(`${file} uses the official matching four-step turbo path`, () => {
    const workflow = JSON.parse(readFileSync(resolve("workflows", file), "utf8")) as ComfyWorkflow;
    const lora = Object.values(workflow).find((node) => node.class_type === "LoraLoaderModelOnly");
    const turboScheduler = Object.values(workflow).find(
      (node) => node.class_type === "BasicScheduler" && node._meta?.title === "Turbo scheduler",
    );
    const toggle = Object.values(workflow).find(
      (node) => node.class_type === "PrimitiveBoolean" && /Turbo LoRA/.test(node._meta?.title ?? ""),
    );
    assert.equal(lora?.inputs.lora_name, expected);
    assert.equal(turboScheduler?.inputs.steps, 4);
    assert.match(toggle?._meta?.title ?? "", /4 steps/);
  });
}

test("H3 starter registry pins the official turbo asset", () => {
  const model = STARTER_MODELS.find((item) => item.id === "h3-turbo-lora");
  assert.equal(model?.filename, expected);
  assert.equal(model?.sizeBytes, 1_956_192_992);
  assert.equal(model?.sha256, "c396a9a06f58399e9df9754b18299818d84a2ddd371724ba48fe4a41221437dc");
  assert.match(model?.source.type === "url" ? model.source.url : "", /^https:\/\/huggingface\.co\/Comfy-Org\/MiniMax-H3\//);
});
