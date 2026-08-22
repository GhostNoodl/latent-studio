import test from "node:test";
import assert from "node:assert/strict";
import { pickCheckpointFallback } from "../frontend/src/lib/checkpointFallback.ts";

const installed = [
  "LTX23_audio_vae_bf16.safetensors",
  "bananaKiwiXL_v10.safetensors",
  "illustriousXL20_v20.safetensors",
  "ltx-2.3_text_projection_bf16.safetensors",
];

test("checkpoint fallback prefers a related installed model", () => {
  assert.equal(
    pickCheckpointFallback("waiIllustriousSDXL_v170.safetensors", installed, installed),
    "illustriousXL20_v20.safetensors",
  );
});

test("checkpoint fallback does not choose auxiliary files from the checkpoint folder", () => {
  const pick = pickCheckpointFallback("removedModel.safetensors", installed, installed);
  assert.equal(pick, "bananaKiwiXL_v10.safetensors");
  assert.doesNotMatch(pick!, /vae|audio|projection|encoder/i);
});

test("checkpoint fallback preserves an exact installed selection", () => {
  assert.equal(
    pickCheckpointFallback("models/illustriousXL20_v20.safetensors", installed, installed),
    "illustriousXL20_v20.safetensors",
  );
});
