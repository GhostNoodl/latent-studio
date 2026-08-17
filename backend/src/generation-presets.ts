import type {
  GenerationQualityPreset,
  ParamSpec,
  ParamValue,
  WorkflowManifest,
} from "@latent/shared";

/**
 * Apply a small, explainable speed/quality policy to resolved parameter values.
 * The manifest and caller's values are never mutated. Unknown/imported pipelines
 * simply keep settings that the policy cannot identify safely.
 */
export function applyGenerationPreset(
  manifest: WorkflowManifest,
  values: Record<string, ParamValue>,
  preset: GenerationQualityPreset | undefined,
): Record<string, ParamValue> {
  const next = { ...values };
  if (!preset) return next;

  if (manifest.type === "image") applyImagePreset(manifest, next, preset);
  if (manifest.type === "video") applyVideoPreset(manifest, next, preset);
  return next;
}

function applyImagePreset(
  manifest: WorkflowManifest,
  values: Record<string, ParamValue>,
  preset: GenerationQualityPreset,
): void {
  const finishingToggle = (spec: ParamSpec) =>
    spec.input === "__enabled" && /hires|face\s*detail/i.test(`${spec.section ?? ""} ${spec.label}`);

  for (const spec of manifest.params.filter(finishingToggle)) {
    values[spec.key] = preset === "final";
  }

  if (preset !== "draft") return;
  for (const spec of manifest.params) {
    const node = manifest.workflow[spec.nodeId];
    const finishing = /hires|face\s*detail/i.test(`${spec.section ?? ""} ${node?._meta?.title ?? ""}`);
    if (spec.input !== "steps" || node?.class_type !== "KSampler" || finishing) continue;
    const current = numericValue(values[spec.key], spec.default);
    if (current !== undefined) values[spec.key] = Math.min(current, 14);
  }
}

function applyVideoPreset(
  manifest: WorkflowManifest,
  values: Record<string, ParamValue>,
  preset: GenerationQualityPreset,
): void {
  const isH3 = /minimax\s*h3/i.test(`${manifest.baseGroup ?? ""} ${manifest.name}`);
  for (const spec of manifest.params) {
    const words = `${spec.label} ${spec.section ?? ""}`;
    if (/duration/i.test(words)) {
      if (preset === "draft") values[spec.key] = 2;
      else if (preset === "standard") values[spec.key] = 5;
    }
    if (spec.input === "__enabled" && /audio/i.test(words) && preset === "draft") {
      values[spec.key] = false;
    }
    if (!isH3) continue;
    if (/^width$/i.test(spec.label)) {
      if (preset === "draft") values[spec.key] = 864;
      else if (preset === "standard") values[spec.key] = 1344;
    }
    if (/^height$/i.test(spec.label)) {
      if (preset === "draft") values[spec.key] = 480;
      else if (preset === "standard") values[spec.key] = 768;
    }
    if (/turbo\s*lora/i.test(spec.label)) values[spec.key] = preset !== "final";
  }
}

function numericValue(value: ParamValue | undefined, fallback: ParamValue | undefined): number | undefined {
  const candidate = typeof value === "number" ? value : fallback;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}
