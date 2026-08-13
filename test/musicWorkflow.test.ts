import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComfyWorkflow } from "@latent/shared";

const workflow = JSON.parse(
  readFileSync(new URL("../workflows/MiniMax Music 3 T2M API.json", import.meta.url), "utf8"),
) as ComfyWorkflow;

test("bundled Music 3 workflow uses native nodes and the recommended quantized model pack", () => {
  assert.equal(workflow["1"]?.class_type, "UNETLoader");
  assert.equal(workflow["1"]?.inputs.unet_name, "minimax_music3_dit_int8_convrot.safetensors");
  assert.equal(workflow["2"]?.class_type, "CLIPLoader");
  assert.equal(
    workflow["2"]?.inputs.clip_name,
    "minimax_music3_text_encoder_pruned_int8_convrot.safetensors",
  );
  assert.equal(workflow["3"]?.inputs.vae_name, "minimax_music3_dav.safetensors");
  assert.equal(workflow["5"]?.class_type, "MiniMaxMusic3TextEncode");
  assert.equal(workflow["7"]?.class_type, "EmptyMiniMaxMusic3LatentAudio");
});

test("bundled Music 3 workflow uses ComfyUI's nested dynamic audio-quality key", () => {
  assert.equal(workflow["12"]?.class_type, "SaveAudioAdvanced");
  assert.equal(workflow["12"]?.inputs.format, "mp3");
  assert.equal(workflow["12"]?.inputs["format.quality"], "V0");
  assert.equal(workflow["12"]?.inputs.quality, undefined);
});
