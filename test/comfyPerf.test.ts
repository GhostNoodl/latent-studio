import test from "node:test";
import assert from "node:assert/strict";
import { buildPerfArgs } from "../backend/src/comfy-perf.ts";

test("recommended Comfy profile avoids all-features --fast and keeps previews", () => {
  assert.deepEqual(buildPerfArgs({ runtime: "fast", preview: "full", vram: "off" }), [
    "--preview-method", "auto", "--fast", "fp16_accumulation", "cublas_ops",
  ]);
});

test("preview and VRAM policies compose independently", () => {
  assert.deepEqual(buildPerfArgs({ runtime: "stable", preview: "light", vram: "balanced" }), [
    "--preview-method", "auto", "--preview-size", "256", "--fp8_e4m3fn-unet",
  ]);
  assert.deepEqual(buildPerfArgs({ runtime: "experimental", preview: "off", vram: "aggressive" }), [
    "--preview-method", "none", "--fp8_e4m3fn-unet", "--lowvram", "--fast",
  ]);
});
