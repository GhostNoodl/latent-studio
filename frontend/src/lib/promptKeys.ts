import type { WorkflowManifest } from "@latent/shared";

/**
 * Locate a pipeline's positive/negative prompt fields by label heuristic
 * (the same convention Prompt Studio and prompt locking rely on). Positive
 * prefers a "positive" label; falls back to a bare "Prompt" (e.g. the MiniMax
 * H3 nodes name their prompt input exactly that).
 */
export function posPromptKey(manifest: WorkflowManifest): string | undefined {
  const areas = manifest.params.filter((p) => p.control === "textarea");
  return (
    areas.find((p) => /pos/i.test(p.label)) ?? areas.find((p) => p.label.trim() === "Prompt")
  )?.key;
}

export function negPromptKey(manifest: WorkflowManifest): string | undefined {
  return manifest.params.find((p) => p.control === "textarea" && /neg/i.test(p.label))?.key;
}

/** MiniMax Music 3 exposes two deliberately independent multiline inputs. */
export function musicCaptionKey(manifest: WorkflowManifest): string | undefined {
  return manifest.params.find(
    (p) => p.control === "textarea" && (p.input === "caption" || /^caption$/i.test(p.label.trim())),
  )?.key;
}

export function musicLyricsKey(manifest: WorkflowManifest): string | undefined {
  return manifest.params.find(
    (p) => p.control === "textarea" && (p.input === "lyrics" || /^lyrics$/i.test(p.label.trim())),
  )?.key;
}
