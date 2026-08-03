import type { WorkflowManifest } from "@latent/shared";

/**
 * Locate a pipeline's positive/negative prompt fields by label heuristic
 * (the same convention Prompt Studio and prompt locking rely on).
 */
export function posPromptKey(manifest: WorkflowManifest): string | undefined {
  return manifest.params.find((p) => p.control === "textarea" && /pos/i.test(p.label))?.key;
}

export function negPromptKey(manifest: WorkflowManifest): string | undefined {
  return manifest.params.find((p) => p.control === "textarea" && /neg/i.test(p.label))?.key;
}
