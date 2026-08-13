import type { ComfyWorkflow, ObjectInfo, PipelineRequirements } from "@latent/shared";

/** Compare a workflow's node classes with the capabilities advertised by ComfyUI. */
export function pipelineRequirements(
  workflow: ComfyWorkflow,
  objectInfo: ObjectInfo,
): PipelineRequirements {
  const requiredNodes = [...new Set(Object.values(workflow).map((node) => node.class_type))].sort();
  const missingNodes = requiredNodes.filter((classType) => !objectInfo[classType]);
  return { ready: missingNodes.length === 0, requiredNodes, missingNodes };
}
