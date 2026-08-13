import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManifestParams } from "../backend/src/manifest-builder.ts";
import type { ComfyWorkflow, ObjectInfo } from "@latent/shared";

test("Music 3 controls expose song fields, capped duration, and typed model pickers", () => {
  const workflow = {
    clip: {
      class_type: "CLIPLoader",
      inputs: { clip_name: "encoder.safetensors", type: "minimax", device: "default" },
      _meta: { title: "Text encoder" },
    },
    vae: {
      class_type: "VAELoader",
      inputs: { vae_name: "audio-vae.safetensors" },
      _meta: { title: "Audio VAE" },
    },
    song: {
      class_type: "MiniMaxMusic3TextEncode",
      inputs: {
        clip: ["clip", 0],
        caption: "caption",
        lyrics: "[Verse]",
        seed: 1,
        max_duration: 60,
        cfg_scale: 1.7,
        top_k: 50,
      },
    },
  } satisfies ComfyWorkflow;
  const objectInfo = {
    CLIPLoader: {
      input: { required: { clip_name: [["encoder.safetensors"]], type: [["minimax"]], device: [["default"]] } },
    },
    VAELoader: {
      input: { required: { vae_name: [["audio-vae.safetensors"]] } },
    },
    MiniMaxMusic3TextEncode: {
      input: {
        required: {
          clip: [["CLIP"]],
          caption: ["STRING", { multiline: true }],
          lyrics: ["STRING", { multiline: true }],
          seed: ["INT", { min: 0, max: Number.MAX_SAFE_INTEGER }],
          max_duration: ["FLOAT", { min: 0.04, max: 360, step: 0.04 }],
          cfg_scale: ["FLOAT", { min: 0, max: 100, step: 0.1 }],
          top_k: ["INT", { min: 1, max: 8192 }],
        },
      },
    },
  } as unknown as ObjectInfo;

  const params = buildManifestParams(workflow, objectInfo);
  assert.equal(params.find((param) => param.key === "song.caption")?.group, "simple");
  assert.equal(params.find((param) => param.key === "song.lyrics")?.control, "textarea");
  const duration = params.find((param) => param.key === "song.max_duration");
  assert.equal(duration?.min, 1);
  assert.equal(duration?.max, 300);
  assert.equal(duration?.step, 1);
  assert.equal(params.find((param) => param.key === "clip.clip_name")?.modelKind, "text_encoder");
  assert.equal(params.find((param) => param.key === "clip.clip_name")?.group, "simple");
  assert.equal(params.find((param) => param.key === "vae.vae_name")?.modelKind, "vae");
});
