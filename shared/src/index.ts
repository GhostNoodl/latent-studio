// Shared contract between the Latent backend and frontend.
// Keep this free of runtime dependencies — types and small const maps only.

// ─────────────────────────────────────────────────────────────────────────────
// ComfyUI API-format workflow
// A workflow in "API format" is a map of nodeId -> node. Each node has a
// class_type and an `inputs` bag whose values are either literals or a
// [sourceNodeId, outputIndex] link tuple.
// ─────────────────────────────────────────────────────────────────────────────

export type ComfyInputValue = string | number | boolean | ComfyLink | null;
export type ComfyLink = [string, number];

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, ComfyInputValue>;
  _meta?: { title?: string };
}

export type ComfyWorkflow = Record<string, ComfyNode>;

// ─────────────────────────────────────────────────────────────────────────────
// Param model — the bridge between friendly controls and workflow node inputs.
// ─────────────────────────────────────────────────────────────────────────────

export type ParamControl =
  | "textarea"
  | "text"
  | "slider"
  | "number"
  | "select"
  | "seed"
  | "image"
  | "toggle"
  | "loras"
  | "mask"; // paint a black/white inpaint mask (feeds a LoadImageMask node)

/** One LoRA in a Power Lora Loader stack. */
export interface LoraEntry {
  on: boolean;
  lora: string;
  strength: number;
}

/** A param value — most are scalars; a `loras` control holds a LoRA list. */
export type ParamValue = ComfyInputValue | LoraEntry[];

export interface ParamSpec {
  /** Stable key used in the UI store and gallery records. */
  key: string;
  label: string;
  /** Target node + input in the workflow JSON. */
  nodeId: string;
  input: string;
  control: ParamControl;
  /** Disclosure level: simple = curated essentials, advanced = power-user. */
  group: "simple" | "advanced";
  /** Optional grouping label within the advanced drawer (usually node title). */
  section?: string;
  help?: string;
  // Hydrated/validated from /object_info where available.
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  default?: ParamValue;
  /** When set, this is a model selector — render the rich ModelPicker. */
  modelKind?: ModelKind;
  /**
   * An on/off toggle that, when false, bypasses a node: its `input` link is
   * passed straight to whatever consumed the node's `output` slot, then the node
   * is removed. Used to make hires-fix / optional passes switchable.
   */
  bypass?: {
    nodeId: string;
    /** A single link to reroute when the node is spliced out (e.g. hires-fix). */
    input?: string;
    output?: number;
    /** Multiple links to reroute at once (e.g. ControlNet apply passes both its
     *  positive output 0 and negative output 1 straight through). */
    links?: { input: string; output: number }[];
  };
  /**
   * For a `mask` control: the key of the sibling image param whose current image
   * is the backdrop to paint the mask over (so source + mask stay aligned).
   */
  paintTarget?: string;
  /**
   * Show this param only when another param (usually a feature's on/off toggle)
   * has the given value — e.g. hide the ControlNet reference/strength params
   * until "Enable ControlNet" is on.
   */
  visibleWhen?: { key: string; equals: ParamValue };
  /**
   * Marks a ControlNet preprocessor selector: the UI renders a live control-map
   * preview beneath it, driven by the referenced source-image + resolution params.
   */
  cnPreview?: { imageKey?: string; resolutionKey?: string };
}

export type PipelineType = "image" | "video";

/** Whether a param should render, given the current values (respects `visibleWhen`). */
export function isParamVisible(spec: ParamSpec, values: Record<string, ParamValue>): boolean {
  if (!spec.visibleWhen) return true;
  return values[spec.visibleWhen.key] === spec.visibleWhen.equals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model catalog (clean names, thumbnails, Civitai metadata from Stability Matrix)
// ─────────────────────────────────────────────────────────────────────────────

export type ModelKind =
  | "checkpoint"
  | "diffusion"
  | "lora"
  | "vae"
  | "upscale"
  | "controlnet"
  | "embedding";

/**
 * A user-added filesystem folder that Latent + the managed ComfyUI also search
 * for models. `kind` is a specific model type (the whole folder holds that type)
 * or `"root"` (a full ComfyUI-style models tree with StableDiffusion/Lora/… subdirs).
 */
export interface CustomModelPath {
  id: string;
  path: string;
  kind: ModelKind | "root";
  /** Optional label shown in the UI; defaults to the folder name. */
  label?: string;
}

export interface ModelInfo {
  /** Filename exactly as object_info reports it (the value used in workflows). */
  file: string;
  kind: ModelKind;
  /** Friendly display name (from cm-info, else a cleaned filename). */
  name: string;
  versionName?: string;
  baseModel?: string;
  modelType?: string;
  author?: string;
  trainedWords?: string[];
  tags?: string[];
  nsfw?: boolean;
  civitaiModelId?: number;
  civitaiVersionId?: number;
  stats?: { downloadCount?: number; thumbsUpCount?: number; rating?: number };
  /** True when a local preview image is available via /api/models/preview. */
  hasPreview: boolean;
  /** Remote thumbnail URL (Civitai), used when no local preview exists. */
  previewUrl?: string;
  /** Source of the metadata: local cm-info, Civitai enrichment, or none. */
  source: "local" | "civitai" | "none";
}

// ─────────────────────────────────────────────────────────────────────────────
// Presets (image dimensions, prompt styles, full param bundles)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Tag autocomplete (booru tags)
// ─────────────────────────────────────────────────────────────────────────────

export interface TagSuggestion {
  name: string;
  category: number;
  count: number;
  /** Present when matched via an alias rather than the canonical name. */
  alias?: string;
}

export type PresetKind = "dimensions" | "style" | "bundle" | "snippet";

export interface Preset {
  id: string;
  kind: PresetKind;
  name: string;
  /** null = global; otherwise scoped to a pipeline. */
  pipelineId: string | null;
  /** Shape depends on kind: dimensions {width,height}; style {positive?,negative?};
   *  bundle Record<paramKey, value>; snippet {text}. */
  data: Record<string, ParamValue>;
  createdAt: string;
}

export interface WorkflowManifest {
  id: string;
  name: string;
  type: PipelineType;
  /** ComfyUI API-format workflow JSON. */
  workflow: ComfyWorkflow;
  /** Curated + advanced param specs exposed in the UI. */
  params: ParamSpec[];
  /** Top-level tab family (e.g. "Illustrious", "WAN 2.2"). Ungrouped → "Custom". */
  baseGroup?: string;
  /** Sub-tab label within the base (e.g. "txt2img", "img2img", "inpaint", "video"). */
  mode?: string;
  /** Sort order of the sub-tab within its base group (ascending). */
  order?: number;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// /object_info (subset we rely on)
// ─────────────────────────────────────────────────────────────────────────────

/** [type | enumValues, options?] — ComfyUI's input spec tuple. */
export type ObjectInputSpec = [string | string[]] | [string | string[], Record<string, unknown>];

export interface ObjectInfoNode {
  input: {
    required?: Record<string, ObjectInputSpec>;
    optional?: Record<string, ObjectInputSpec>;
  };
  output: string[];
  output_name: string[];
  name: string;
  display_name: string;
  category: string;
}

export type ObjectInfo = Record<string, ObjectInfoNode>;

// ─────────────────────────────────────────────────────────────────────────────
// Generation lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export type GenerationStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface OutputAsset {
  /** Path served by the backend, e.g. /outputs/<file>. */
  url: string;
  type: "image" | "video";
  filename: string;
  width?: number;
  height?: number;
}

export interface GenerationRecord {
  id: string;
  pipelineId: string;
  pipelineName: string;
  pipelineType: PipelineType;
  status: GenerationStatus;
  promptId?: string;
  seed?: number;
  /** Full resolved param values keyed by ParamSpec.key. */
  params: Record<string, ParamValue>;
  outputs: OutputAsset[];
  thumbnail?: string;
  favorite: boolean;
  rating?: number;
  tags: string[];
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface GenerateRequest {
  pipelineId: string;
  /** Param values keyed by ParamSpec.key. Server merges into the manifest. */
  values: Record<string, ParamValue>;
  /** Optional raw-mode override: submit this exact workflow instead of the manifest. */
  rawWorkflow?: ComfyWorkflow;
  seedMode?: "fixed" | "random" | "increment";
  /** Batch: number of jobs to enqueue (seed varies per job for random/increment). */
  batch?: number;
  /**
   * Batch builder: one entry per run, each a set of param overrides merged over
   * `values` (parameter sweeps / prompt-list batches). Takes precedence over `batch`.
   */
  runs?: Record<string, ParamValue>[];
}

export interface GenerateResponse {
  generationIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket messages (backend -> browser). Mirrors/augments ComfyUI's WS.
// ─────────────────────────────────────────────────────────────────────────────

export type ServerEvent =
  | { type: "status"; queueRemaining: number }
  | { type: "progress"; generationId?: string; promptId?: string; value: number; max: number }
  | { type: "executing"; generationId?: string; promptId?: string; node: string | null }
  | { type: "preview"; generationId?: string; promptId?: string; dataUrl: string }
  | { type: "generation"; record: GenerationRecord }
  | { type: "download"; job: DownloadJob }
  | { type: "setup"; status: SetupStatus }
  | { type: "log"; entry: LogEntry }
  | { type: "error"; generationId?: string; message: string };

/** A captured line of process output surfaced in the in-app log console. */
export type LogSource = "backend" | "comfy";
export interface LogEntry {
  /** Monotonic id (ordering + React keys). */
  id: number;
  source: LogSource;
  text: string;
  /** Epoch ms. */
  at: number;
  /** Coarse level parsed from the line, for colour. */
  level?: "info" | "warn" | "error";
}

export interface HealthStatus {
  backend: "ok";
  comfyui: "ok" | "unreachable";
  comfyuiUrl: string;
  objectInfoCached: boolean;
  /** Latent launched ComfyUI and it hasn't finished booting yet (still starting). */
  comfyStarting: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// First-run ComfyUI setup (download/extract/launch the official portable)
// ─────────────────────────────────────────────────────────────────────────────

export interface GpuInfo {
  vendor: "nvidia" | "amd" | "intel" | "cpu";
  name?: string;
  vramMb?: number;
}

export type SetupPhase =
  | "idle"
  | "downloading"
  | "extracting"
  | "launching"
  | "installing-nodes"
  | "ready"
  | "failed";

export interface SetupStatus {
  /** An existing ComfyUI (Stability Matrix or a prior managed install) is up. */
  comfyReachable: boolean;
  /** A Latent-managed portable install exists on disk. */
  managedInstalled: boolean;
  gpu?: GpuInfo;
  /** The portable release Latent would download for this GPU. */
  release?: { tag: string; asset: string; sizeBytes: number };
  phase: SetupPhase;
  /** Download progress (bytes). */
  received?: number;
  total?: number;
  message?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collections (named albums of generations)
// ─────────────────────────────────────────────────────────────────────────────

export interface Collection {
  id: string;
  name: string;
  /** Number of generations in the collection. */
  count: number;
  /** Thumbnail of the most recent member, for the collection cover. */
  cover?: string;
  createdAt: string;
}

/** A user-created folder for organizing models (checkpoints, LoRAs, …). */
export interface ModelFolder {
  id: string;
  name: string;
  /** Member count — scoped to a single kind when the query specifies one. */
  count: number;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Civitai browser + downloads
// ─────────────────────────────────────────────────────────────────────────────

export interface CivitaiImage {
  url: string;
  /** Civitai serves animated previews too — "video" URLs must render in <video>, not <img>. */
  type: "image" | "video";
  nsfwLevel: number;
  width?: number;
  height?: number;
}

export interface CivitaiFile {
  name: string;
  sizeKB: number;
  format?: string;
  primary: boolean;
  downloadUrl: string;
  sha256?: string;
}

export interface CivitaiVersion {
  id: number;
  name: string;
  baseModel?: string;
  trainedWords: string[];
  images: CivitaiImage[];
  files: CivitaiFile[];
}

/** A normalized Civitai model (search result or detail). */
export interface CivitaiModelResult {
  id: number;
  name: string;
  /** Civitai type: Checkpoint / LORA / VAE / Upscaler / Controlnet / TextualInversion / … */
  type: string;
  nsfw: boolean;
  author?: string;
  /** Creator avatar URL, when available. */
  authorImage?: string;
  /** Model description (raw HTML from Civitai). */
  description?: string;
  tags: string[];
  stats: { downloadCount?: number; thumbsUpCount?: number; rating?: number; favoriteCount?: number };
  versions: CivitaiVersion[];
  /** First preview image of the first version, for the card. */
  cover?: string;
}

export interface CivitaiSearchResult {
  items: CivitaiModelResult[];
  /** Opaque cursor for the next page (undefined = end). */
  nextCursor?: string;
}

export type DownloadStatus = "downloading" | "completed" | "failed" | "canceled";

/** A model download into the local models folders. */
export interface DownloadJob {
  id: string;
  name: string;
  /** "other" covers non-catalog kinds (text encoders, RIFE, yolo) downloaded by URL. */
  kind: ModelKind | "other";
  status: DownloadStatus;
  /** Bytes received / total (total = 0 when unknown). */
  received: number;
  total: number;
  error?: string;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// First-run onboarding: curated starter models + onboarding state
// ─────────────────────────────────────────────────────────────────────────────

/** Where a starter model is fetched from. */
export type StarterModelSource =
  | { type: "civitai"; modelId: number; versionId: number }
  | { type: "url"; url: string; headers?: Record<string, string> };

/** A curated model offered during first-run onboarding. */
export interface StarterModel {
  /** Stable slug (also used as the download's dedupe/source id). */
  id: string;
  label: string;
  description: string;
  /** Top-level group: the Illustrious image side or the WAN video side. */
  pack: "illustrious" | "wan";
  /** Sub-group heading within the pack (e.g. "Anime — all-rounders", "Support & extras"). */
  category: string;
  /** Starred as the suggested pick for its category. */
  recommended?: boolean;
  /** Real catalog kind when applicable (drives picker refresh); omitted for text-encoders/RIFE/etc. */
  kind?: ModelKind;
  /** Target folder under the models root (may be nested, e.g. "VAE/Wan"). */
  folder: string;
  /** Final filename — for pipeline-referenced files this MUST match the pipeline's default. */
  filename: string;
  sizeBytes?: number;
  nsfw?: boolean;
  previewUrl?: string;
  source: StarterModelSource;
}

/** A starter model annotated with local install state (from GET /api/starter-models). */
export interface StarterModelState extends StarterModel {
  installed: boolean;
}

/** Onboarding completion state (GET /api/onboarding). */
export interface OnboardingStatus {
  /** ISO timestamp when onboarding was completed/skipped, or null if never. */
  onboardedAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue (live view of ComfyUI's queue, cross-referenced to our generations)
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueItem {
  promptId: string;
  generationId?: string;
  pipelineName?: string;
  seed?: number;
  thumbnail?: string;
  running: boolean;
}

export interface QueueSnapshot {
  running: QueueItem[];
  pending: QueueItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow injection — the single transform from (manifest + values) → a ComfyUI
// graph. Shared by the backend (before queueing a prompt) and the frontend (to
// seed the raw-JSON editor with what would actually run), so the two can't drift.
// NOTE: seed variation and prompt wildcard expansion are applied by the backend
// caller BEFORE this — they are not part of the graph injection.
// ─────────────────────────────────────────────────────────────────────────────

/** Remove a node, passing its `input` link straight to whatever read its `output`. */
function bypassNode(
  wf: ComfyWorkflow,
  b: {
    nodeId: string;
    input?: string;
    output?: number;
    links?: { input: string; output: number }[];
  },
): void {
  const node = wf[b.nodeId];
  if (!node) return;
  const links =
    b.links ??
    (b.input !== undefined && b.output !== undefined
      ? [{ input: b.input, output: b.output }]
      : []);
  // Resolve each spliced output to the upstream source it should forward. Abort
  // (leave the node in place) if any expected source link is missing.
  const reroute = new Map<number, ComfyInputValue>();
  for (const l of links) {
    const source = node.inputs[l.input];
    if (source === undefined) return;
    reroute.set(l.output, source);
  }
  for (const n of Object.values(wf)) {
    for (const key of Object.keys(n.inputs)) {
      const v = n.inputs[key];
      if (Array.isArray(v) && v[0] === b.nodeId && reroute.has(v[1] as number)) {
        n.inputs[key] = reroute.get(v[1] as number)!;
      }
    }
  }
  delete wf[b.nodeId];
}

/** Inject a LoRA stack into an rgthree Power Lora Loader node (lora_N dicts). */
function injectLoras(node: ComfyNode, loras: LoraEntry[]): void {
  // Drop any pre-existing lora_* dict inputs, keep model/clip/widgets.
  for (const key of Object.keys(node.inputs)) {
    const v = node.inputs[key] as unknown;
    if (v && typeof v === "object" && !Array.isArray(v) && "lora" in (v as object)) {
      delete node.inputs[key];
    }
  }
  loras.forEach((l, i) => {
    node.inputs[`lora_${i + 1}`] = {
      on: l.on,
      lora: l.lora,
      strength: l.strength,
    } as unknown as ComfyInputValue;
  });
}

/**
 * Clone the manifest workflow and inject param values into their target node
 * inputs. Handles three shapes: a scalar set, a LoRA stack (`control: "loras"`),
 * and a bypass toggle (`spec.bypass`, spliced out when the value is false).
 */
export function buildWorkflow(
  manifest: WorkflowManifest,
  values: Record<string, ParamValue>,
): ComfyWorkflow {
  const wf: ComfyWorkflow = structuredClone(manifest.workflow);
  for (const spec of manifest.params) {
    const value = values[spec.key];
    if (value === undefined) continue;
    if (spec.bypass) {
      if (value === false) bypassNode(wf, spec.bypass);
      continue; // the synthetic toggle has no real node input
    }
    const node = wf[spec.nodeId];
    if (!node) continue;
    if (spec.control === "loras") {
      injectLoras(node, (value as LoraEntry[]) ?? []);
    } else {
      node.inputs[spec.input] = value as ComfyInputValue;
    }
  }
  return wf;
}
