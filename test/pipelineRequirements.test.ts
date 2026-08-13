import { test } from "node:test";
import assert from "node:assert/strict";
import { pipelineRequirements } from "../backend/src/pipeline-requirements.ts";
import type { ComfyWorkflow, ObjectInfo } from "@latent/shared";

const workflow = {
  "1": { class_type: "UNETLoader", inputs: {} },
  "2": { class_type: "MiniMaxMusic3TextEncode", inputs: {} },
  "3": { class_type: "UNETLoader", inputs: {} },
} satisfies ComfyWorkflow;

test("pipeline requirements report unique missing ComfyUI node classes", () => {
  const objectInfo = { UNETLoader: {} } as ObjectInfo;
  assert.deepEqual(pipelineRequirements(workflow, objectInfo), {
    ready: false,
    requiredNodes: ["MiniMaxMusic3TextEncode", "UNETLoader"],
    missingNodes: ["MiniMaxMusic3TextEncode"],
  });
});

test("pipeline requirements are ready when every class is advertised", () => {
  const objectInfo = {
    UNETLoader: {},
    MiniMaxMusic3TextEncode: {},
  } as ObjectInfo;
  assert.equal(pipelineRequirements(workflow, objectInfo).ready, true);
});
