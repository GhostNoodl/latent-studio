import type {
  ComfyInputValue,
  ComfyWorkflow,
  LoraEntry,
  ModelKind,
  ObjectInfo,
  ObjectInputSpec,
  ParamControl,
  ParamSpec,
} from "@latent/shared";

/** Read any existing LoRA entries (rgthree dict inputs) off a node. */
function readExistingLoras(inputs: Record<string, ComfyInputValue>): LoraEntry[] {
  const out: LoraEntry[] = [];
  for (const value of Object.values(inputs)) {
    const v = value as unknown;
    if (v && typeof v === "object" && !Array.isArray(v) && "lora" in (v as object)) {
      const o = v as { on?: boolean; lora: string; strength?: number };
      out.push({ on: o.on ?? true, lora: String(o.lora), strength: Number(o.strength ?? 1) });
    }
  }
  return out;
}

const UPSCALE_NODE_CLASSES = new Set(["UpscaleModelLoader", "easy hiresFix"]);

/** Classify a model-selector input so the UI can render the rich ModelPicker. */
function modelKindFor(classType: string, input: string): ModelKind | undefined {
  if (input === "ckpt_name") return "checkpoint";
  if (input === "unet_name") return "diffusion";
  if (input === "vae_name") return "vae";
  if (input === "lora_name" || input === "lora") return "lora";
  if (input === "control_net_name") return "controlnet";
  if (input === "model_name" && UPSCALE_NODE_CLASSES.has(classType)) return "upscale";
  return undefined;
}

/**
 * Heuristically derive a param manifest from an API-format workflow, hydrated
 * from ComfyUI's /object_info (min/max/step/enum + multiline flags).
 *
 * - Only literal inputs that map to a real widget in object_info become params
 *   (linked inputs and dynamic/custom widgets are skipped).
 * - A curated allow-list of (class_type, input) lands in the "simple" group;
 *   everything else is "advanced" — so the power user still gets everything.
 */

// (class_type → inputs) surfaced in the Simple panel.
const SIMPLE: Record<string, string[]> = {
  CLIPTextEncode: ["text"],
  CheckpointLoaderSimple: ["ckpt_name"],
  UNETLoader: ["unet_name"],
  UnetLoaderGGUF: ["unet_name"],
  EmptyLatentImage: ["width", "height", "batch_size"],
  KSampler: ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"],
  KSamplerAdvanced: ["noise_seed", "steps", "cfg", "sampler_name", "scheduler"],
  FluxGuidance: ["guidance"],
  // Primitive value nodes (prompts, seed, duration, fps, …) — labelled by node title.
  PrimitiveStringMultiline: ["value"],
  PrimitiveString: ["value"],
  PrimitiveInt: ["value"],
  PrimitiveFloat: ["value"],
  "KSampler Config (rgthree)": ["steps_total", "refiner_step", "cfg", "sampler_name", "scheduler"],
  DaSiWa_ResolutionScaleCalculator: ["resolution_preset"],
  // Hires fix (latent upscale + refine) is surfaced via node title ("Hires Fix") —
  // see isHires* below. The old pixel-upscale "easy hiresFix" is no longer used.
  UpscaleModelLoader: ["model_name"],
  // Inpaint quality controls (mask coverage in the latent + soft paste-back blend).
  VAEEncodeForInpaint: ["grow_mask_by"],
  GrowMaskWithBlur: ["expand", "blur_radius"],
  // ControlNet guidance (strength 0 = off).
  ControlNetApplyAdvanced: ["strength", "start_percent", "end_percent"],
  // ControlNet preprocessor selector (canny/depth/openpose/lineart/…) + resolution.
  AIO_Preprocessor: ["preprocessor", "resolution"],
  // Regional prompting: per-region conditioning strength.
  ConditioningSetMask: ["strength"],
};

// Friendlier labels for the hires-fix node so the model-vs-method distinction reads clearly.
const HIRES_LABELS: Record<string, string> = {
  model_name: "Upscale model",
  rescale_after_model: "Rescale after model",
  rescale_method: "Rescale method",
  rescale: "Rescale by",
  percent: "Scale amount (%)",
  longer_side: "Longer side (px)",
};

// Inputs whose friendly label should come from the node's title, not the input name.
const TITLE_LABEL_INPUTS = new Set(["value", "text", "ckpt_name", "unet_name"]);

const SEED_INPUTS = new Set(["seed", "noise_seed"]);

interface InputConfig {
  min?: number;
  max?: number;
  step?: number;
  multiline?: boolean;
  image_upload?: boolean;
  default?: unknown;
  tooltip?: string;
}

function specType(spec: ObjectInputSpec): { type: string | string[]; config: InputConfig } {
  const [type, config] = spec;
  return { type, config: (config ?? {}) as InputConfig };
}

function controlFor(
  inputName: string,
  type: string | string[],
  config: InputConfig,
): { control: ParamControl; options?: string[] } | null {
  // Image-upload widgets (LoadImage etc.) — file picker, not a dropdown.
  if (config.image_upload) return { control: "image" };
  if (Array.isArray(type)) {
    // A [false, true] combo is really a boolean toggle. Rendering it as a <select>
    // shows blank options — React can't render boolean children — so use a toggle.
    if (type.length > 0 && type.every((t) => typeof t === "boolean")) return { control: "toggle" };
    // Enum values can be non-strings (numbers, booleans); stringify for the UI.
    return { control: "select", options: type.map((t) => String(t)) };
  }
  if (SEED_INPUTS.has(inputName)) return { control: "seed" };
  switch (type) {
    case "INT":
    case "FLOAT":
      // Bounded numerics become sliders; unbounded become number inputs.
      return config.max !== undefined && config.max <= 100000
        ? { control: "slider" }
        : { control: "number" };
    case "STRING":
      return { control: config.multiline ? "textarea" : "text" };
    case "BOOLEAN":
      return { control: "toggle" };
    default:
      return null;
  }
}

function humanize(input: string): string {
  return input.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildManifestParams(workflow: ComfyWorkflow, objectInfo: ObjectInfo): ParamSpec[] {
  const params: ParamSpec[] = [];

  for (const [nodeId, node] of Object.entries(workflow)) {
    const info = objectInfo[node.class_type];
    if (!info) continue;
    const declared = { ...(info.input.required ?? {}), ...(info.input.optional ?? {}) };
    const title = node._meta?.title;
    // Latent hires nodes (all titled "Hires Fix"): the refine KSampler exposes only
    // steps + denoise (Hires Steps / Hires Strength), the LatentUpscaleBy exposes only
    // scale_by (Hires Scale), and the LatentSwitch is plumbing (just its toggle).
    const isHiresSampler = node.class_type === "KSampler" && title === "Hires Fix";
    const isHiresUpscale = node.class_type === "LatentUpscaleBy" && title === "Hires Fix";
    const isHiresSwitch = node.class_type === "LatentSwitch" && title === "Hires Fix";
    const simpleInputs = isHiresSampler
      ? ["steps", "denoise"]
      : isHiresUpscale
        ? ["scale_by"]
        : (SIMPLE[node.class_type] ?? []);

    // rgthree Power Lora Loader: a dynamic LoRA stack — expose a dedicated control.
    if (node.class_type === "Power Lora Loader (rgthree)") {
      params.push({
        key: `${nodeId}.loras`,
        label: title && !/power lora/i.test(title) ? title : "LoRAs",
        nodeId,
        input: "loras",
        control: "loras",
        group: "simple",
        section: title ?? node.class_type,
        modelKind: "lora",
        default: readExistingLoras(node.inputs),
      });
      continue;
    }

    // Hires fix (latent upscale + refine) is an optional pass — the "Hires Fix"
    // LatentSwitch outputs the hires latent (input2); toggle (default OFF, so quick
    // base-res gens stay light) bypasses it to input1 (the base latent), orphaning
    // the LatentUpscaleBy + refine KSampler so they're skipped entirely.
    if (node.class_type === "LatentSwitch" && title === "Hires Fix") {
      params.push({
        key: `${nodeId}.__enabled`,
        label: "Enable Hires Fix",
        nodeId,
        input: "__enabled",
        control: "toggle",
        group: "simple",
        section: "Hires Fix",
        default: false,
        bypass: { nodeId, input: "input1", output: 0 },
      });
    }

    // ControlNet is an optional guidance pass — add an on/off toggle (default OFF)
    // that bypasses the apply node: its positive (output 0) and negative (output 1)
    // conditioning flow straight to the sampler, orphaning the upstream
    // preprocessor/loader so ComfyUI skips them entirely.
    if (node.class_type === "ControlNetApplyAdvanced") {
      params.push({
        key: `${nodeId}.__enabled`,
        label: "Enable ControlNet",
        nodeId,
        input: "__enabled",
        control: "toggle",
        group: "simple",
        section: title ?? "ControlNet",
        default: false,
        bypass: {
          nodeId,
          links: [
            { input: "positive", output: 0 },
            { input: "negative", output: 1 },
          ],
        },
      });
    }

    // Regional prompting is an optional pass — the "Regional" ConditioningCombine
    // layers the masked region prompts onto the base positive. Toggle (default OFF)
    // bypasses it back to conditioning_1 (the base), orphaning the region subgraph.
    if (node.class_type === "ConditioningCombine" && title === "Regional") {
      params.push({
        key: `${nodeId}.__enabled`,
        label: "Enable Regional Prompts",
        nodeId,
        input: "__enabled",
        control: "toggle",
        group: "simple",
        section: "Regional",
        default: false,
        bypass: { nodeId, input: "conditioning_1", output: 0 },
      });
    }

    // FaceDetailer is an optional face-cleanup pass — a full extra sampling pass on
    // every detected face. Toggle (default ON to preserve behavior) bypasses it back
    // to its input image, orphaning the detailer + its detector so they're skipped.
    if (node.class_type === "FaceDetailer") {
      params.push({
        key: `${nodeId}.__enabled`,
        label: "Enable Face Detailer",
        nodeId,
        input: "__enabled",
        control: "toggle",
        group: "simple",
        section: "Face Detailer",
        default: true,
        bypass: { nodeId, input: "image", output: 0 },
      });
    }

    for (const [inputName, rawValue] of Object.entries(node.inputs)) {
      // Skip links ([nodeId, slot]) — only literal widget values are params.
      if (Array.isArray(rawValue)) continue;
      const declaredSpec = declared[inputName];
      if (!declaredSpec) continue;
      // Hires refine sampler: suppress everything except steps + denoise.
      if (isHiresSampler && inputName !== "steps" && inputName !== "denoise") continue;
      if (isHiresUpscale && inputName !== "scale_by") continue; // only the scale, not upscale_method
      if (isHiresSwitch) continue; // the latent switch exposes nothing but its toggle

      const { type, config } = specType(declaredSpec);
      const control = controlFor(inputName, type, config);
      if (!control) continue;

      // Primitive "Seed" nodes expose a plain numeric `value`; treat as a seed
      // control so batch/random-seed logic varies it.
      let controlType = control.control;
      if ((controlType === "number" || controlType === "slider") && title && /\bseed\b/i.test(title)) {
        controlType = "seed";
      }
      // A LoadImageMask's image_upload is an inpaint MASK to paint, not a plain source.
      if (node.class_type === "LoadImageMask" && controlType === "image") controlType = "mask";

      // Image uploads (start/end frames) are primary inputs — always surface them,
      // and label them by node title (e.g. "First-Frame-Image").
      const isSimple =
        simpleInputs.includes(inputName) || controlType === "image" || controlType === "mask";
      const label = isHiresUpscale
        ? "Hires Scale"
        : isHiresSampler
        ? inputName === "steps"
          ? "Hires Steps"
          : "Hires Strength"
        : controlType === "mask"
          ? (title ?? "Inpaint Mask")
          : controlType === "image" && title
            ? title
            : node.class_type === "easy hiresFix" && HIRES_LABELS[inputName]
              ? HIRES_LABELS[inputName]
              : title && TITLE_LABEL_INPUTS.has(inputName)
                ? title
                : humanize(inputName);

      params.push({
        key: `${nodeId}.${inputName}`,
        label,
        nodeId,
        input: inputName,
        control: controlType,
        group: isSimple ? "simple" : "advanced",
        section: title ?? node.class_type,
        options: control.options,
        min: typeof config.min === "number" ? config.min : undefined,
        max: typeof config.max === "number" ? config.max : undefined,
        step: typeof config.step === "number" ? config.step : undefined,
        default: rawValue,
        modelKind: modelKindFor(node.class_type, inputName),
        help: typeof config.tooltip === "string" && config.tooltip.trim() ? config.tooltip.trim() : undefined,
      });
    }
  }

  // Feature toggles (ControlNet / hires / regional) hide their own settings until
  // enabled: every param in the feature's bypassed subgraph is gated on the toggle.
  for (const toggle of params) {
    if (toggle.control !== "toggle" || !toggle.bypass) continue;
    const feature = featureNodeIds(workflow, toggle.bypass);
    // Group a feature's scattered controls under the toggle's own section so they
    // read as one panel (ControlNet / Regional; hires falls back to label grouping).
    const section = toggle.section;
    for (const p of params) {
      if (p === toggle) continue;
      if (feature.has(p.nodeId)) {
        p.visibleWhen = { key: toggle.key, equals: true };
        if (section) p.section = section;
      }
    }
  }

  // Link each mask to a base source image so the editor paints over it. Only an
  // UNGATED image counts (the inpaint/img2img source) — a CN reference is a gated
  // feature input, so masks won't latch onto it, and source-less region masks
  // (txt2img) get no target → they paint on a blank canvas.
  const baseImageKey = params.find((p) => p.control === "image" && !p.visibleWhen)?.key;
  if (baseImageKey) {
    for (const p of params) if (p.control === "mask" && !p.paintTarget) p.paintTarget = baseImageKey;
  }

  // Tag the ControlNet preprocessor selector with the source-image + resolution
  // param keys so the UI can render a live control-map preview beside it.
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node.class_type !== "AIO_Preprocessor") continue;
    const preParam = params.find((p) => p.nodeId === nodeId && p.input === "preprocessor");
    if (!preParam) continue;
    const resParam = params.find((p) => p.nodeId === nodeId && p.input === "resolution");
    const imgLink = node.inputs.image;
    const refNodeId = Array.isArray(imgLink) ? String(imgLink[0]) : undefined;
    const refParam = refNodeId
      ? params.find((p) => p.nodeId === refNodeId && p.control === "image")
      : undefined;
    preParam.cnPreview = { imageKey: refParam?.key, resolutionKey: resParam?.key };
  }

  // Simple params first, then advanced — stable, readable ordering.
  return params.sort((a, b) => (a.group === b.group ? 0 : a.group === "simple" ? -1 : 1));
}

/**
 * The nodes that belong exclusively to a bypassable feature: those that can no
 * longer reach an output once the toggled node is spliced out. The bypass's
 * pass-through links are honored (their upstream sources still reach outputs via
 * the reroute), so the main generation path is never counted as part of a feature.
 */
function featureNodeIds(
  workflow: ComfyWorkflow,
  bypass: NonNullable<ParamSpec["bypass"]>,
): Set<string> {
  const { nodeId } = bypass;
  const node = workflow[nodeId];
  if (!node) return new Set();
  const links =
    bypass.links ??
    (bypass.input !== undefined && bypass.output !== undefined
      ? [{ input: bypass.input, output: bypass.output }]
      : []);
  // output slot -> the upstream source it forwards to when bypassed
  const reroute = new Map<number, unknown>();
  for (const l of links) {
    const src = node.inputs[l.input];
    if (src !== undefined) reroute.set(l.output, src);
  }
  // Consumer adjacency in the *bypassed* graph (node removed, links rerouted).
  const consumers = new Map<string, string[]>();
  for (const [id, n] of Object.entries(workflow)) {
    if (id === nodeId) continue;
    for (const raw of Object.values(n.inputs)) {
      let link: unknown = raw;
      if (Array.isArray(raw) && raw[0] === nodeId) link = reroute.get(raw[1] as number);
      if (Array.isArray(link) && typeof link[0] === "string" && link[0] !== nodeId) {
        (consumers.get(link[0]) ?? consumers.set(link[0], []).get(link[0])!).push(id);
      }
    }
  }
  const isSink = (id: string) => /save|preview|videocombine|output/i.test(workflow[id]?.class_type ?? "");
  const memo = new Map<string, boolean>();
  const reaches = (id: string): boolean => {
    if (isSink(id)) return true;
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    memo.set(id, false); // break cycles
    const r = (consumers.get(id) ?? []).some(reaches);
    memo.set(id, r);
    return r;
  };
  const feature = new Set<string>([nodeId]);
  for (const id of Object.keys(workflow)) {
    if (id !== nodeId && !reaches(id)) feature.add(id);
  }
  return feature;
}
