import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config.ts";
import { comfy } from "./comfy.ts";
import { workflows, generations, settings } from "./db.ts";
import { bridge } from "./ws-bridge.ts";
import { expandWildcards } from "./wildcards.ts";
import { buildWorkflow } from "@latent/shared";
import type {
  ComfyWorkflow,
  GenerateRequest,
  GenerationRecord,
  ParamValue,
  WorkflowManifest,
} from "@latent/shared";

const MAX_SEED = 0xffffffffffff; // ComfyUI seeds are large ints

function randomSeed(): number {
  return Math.floor(Math.random() * MAX_SEED);
}

/** Keys of seed-type params, so batch/seedMode can vary them per job. */
function seedKeys(manifest: WorkflowManifest): string[] {
  return manifest.params.filter((p) => p.control === "seed").map((p) => p.key);
}

/**
 * Upscale an existing generation's output with an upscale model (a standalone
 * ComfyUI graph: LoadImage → UpscaleModelLoader → ImageUpscaleWithModel → Save).
 * Creates a new linked generation that streams + saves like any other.
 */
export async function runUpscale(generationId: string, model?: string): Promise<string> {
  const source = generations.get(generationId);
  const output = source?.outputs.find((o) => o.type === "image");
  if (!source || !output) throw new Error("No source image to upscale");

  // Default to a sensible installed upscale model if none was chosen. The spec is
  // either [ [opts], cfg ] or the ComfyUI "COMBO" wrapper [ "COMBO", { options } ].
  let modelName = model;
  if (!modelName) {
    const oi = await comfy.objectInfo();
    const spec = oi.UpscaleModelLoader?.input.required?.model_name;
    const opts = Array.isArray(spec?.[0])
      ? (spec![0] as string[])
      : ((spec?.[1] as { options?: string[] } | undefined)?.options ?? []);
    modelName = opts.find((o) => /anime|realesrgan/i.test(o)) ?? opts[0];
  }
  if (!modelName) throw new Error("No upscale model available");

  // Push the stored output back into ComfyUI as an input.
  const stored = basename(decodeURIComponent(output.url));
  const buffer = await readFile(join(config.dataDir, "outputs", stored));
  const up = await comfy.uploadImage(output.filename, buffer, "image/png");
  const inputName = up.subfolder ? `${up.subfolder}/${up.name}` : up.name;

  const workflow = {
    "1": { class_type: "LoadImage", inputs: { image: inputName }, _meta: { title: "Source" } },
    "2": { class_type: "UpscaleModelLoader", inputs: { model_name: modelName }, _meta: {} },
    "3": {
      class_type: "ImageUpscaleWithModel",
      inputs: { upscale_model: ["2", 0], image: ["1", 0] },
      _meta: {},
    },
    "4": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "Latent/Upscaled", images: ["3", 0] },
      _meta: {},
    },
  } as unknown as ComfyWorkflow;

  const id = nanoid(12);
  generations.insert({
    id,
    pipelineId: source.pipelineId,
    pipelineName: `Upscale · ${modelName.replace(/\.[^.]+$/, "")}`,
    pipelineType: "image",
    status: "queued",
    params: { source: generationId, upscaler: modelName },
    outputs: [],
    favorite: false,
    tags: [],
    createdAt: new Date().toISOString(),
  });

  try {
    const promptId = await comfy.queuePrompt(workflow, bridge.clientId);
    bridge.track(promptId, id);
    const updated = generations.update(id, { status: "running", promptId });
    if (updated) bridge.broadcast({ type: "generation", record: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = generations.update(id, {
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    });
    if (failed) bridge.broadcast({ type: "generation", record: failed });
  }
  return id;
}

/** Read width/height from a PNG's IHDR (bytes 16-23, big-endian). */
function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

const ENHANCE_DENOISE = 0.4;

/** Enhance upscale factor. The refine runs tiled (Ultimate SD Upscale, 1024 tiles) so both
 *  1.5x and 2x fit VRAM on a 16GB card. */
export function getEnhanceFactor(): number {
  return Number(settings.get("enhanceFactor")) === 2 ? 2 : 1.5;
}
export function setEnhanceFactor(factor: number): void {
  settings.set("enhanceFactor", String(factor === 2 ? 2 : 1.5));
}

/**
 * "Enhance" an existing output: ESRGAN-upscale it, then run an img2img refine at the
 * larger size reusing the SOURCE generation's exact graph (checkpoint / LoRAs / prompt /
 * VAE). The high-res refine is what resurrects eyes + microdetail. We rebuild the source
 * workflow with every optional feature off, then reroute its base sampler's latent from
 * EmptyLatentImage to a VAEEncode of the upscaled image, at a lower denoise.
 */
export async function runEnhance(generationId: string): Promise<string> {
  const source = generations.get(generationId);
  const output = source?.outputs.find((o) => o.type === "image");
  if (!source || !output) throw new Error("No source image to enhance");
  const manifest = workflows.get(source.pipelineId);
  if (!manifest) throw new Error("Can't enhance this image — its pipeline is gone.");

  // Trace back through any prior enhance/upscale links to the original gen's settings.
  let paramsSrc = source;
  const seen = new Set<string>();
  while (typeof paramsSrc.params?.source === "string" && !seen.has(paramsSrc.id)) {
    seen.add(paramsSrc.id);
    const prev = generations.get(paramsSrc.params.source as string);
    if (!prev) break;
    paramsSrc = prev;
  }

  // Rebuild that graph with every optional feature toggled off → just the core refine path.
  const vals: Record<string, ParamValue> = { ...paramsSrc.params };
  for (const p of manifest.params) if (p.input === "__enabled") vals[p.key] = false;
  const wf = buildWorkflow(manifest, vals);

  // Locate the base latent → its sampler → the VAE.
  const emptyId = Object.keys(wf).find((id) => /EmptyLatent|EmptySD3Latent/i.test(wf[id]!.class_type));
  const samplerId = emptyId
    ? Object.keys(wf).find((id) => {
        const li = wf[id]!.inputs.latent_image;
        return Array.isArray(li) && li[0] === emptyId;
      })
    : undefined;
  const decodeId = Object.keys(wf).find((id) => wf[id]!.class_type === "VAEDecode");
  const vaeRef = decodeId ? wf[decodeId]!.inputs.vae : undefined;
  if (!emptyId || !samplerId || !decodeId || vaeRef === undefined) {
    throw new Error("This pipeline can't be enhanced (unexpected graph shape).");
  }

  // Extract the source's model / conditioning / sampler settings to feed USDU.
  const sampler = wf[samplerId]!;
  const modelRef = sampler.inputs.model;
  const posRef = sampler.inputs.positive;
  const negRef = sampler.inputs.negative;
  if (modelRef === undefined || posRef === undefined || negRef === undefined) {
    throw new Error("This pipeline can't be enhanced (no model / conditioning to reuse).");
  }
  const steps = typeof sampler.inputs.steps === "number" ? sampler.inputs.steps : 20;
  const cfg = typeof sampler.inputs.cfg === "number" ? sampler.inputs.cfg : 7;
  const samplerName = (sampler.inputs.sampler_name as string) ?? "euler";
  const scheduler = (sampler.inputs.scheduler as string) ?? "normal";

  const buffer = await readFile(join(config.dataDir, "outputs", basename(decodeURIComponent(output.url))));
  const [ow, oh] = pngSize(buffer);
  const factor = getEnhanceFactor();

  // Pick an upscale model (prefer a sharp/anime one — the refine redraws anyway).
  const oi = await comfy.objectInfo();
  if (!oi.UltimateSDUpscale) {
    throw new Error("Enhance needs the Ultimate SD Upscale node. Restart Latent to install it (or add ComfyUI_UltimateSDUpscale via ComfyUI Manager).");
  }
  const spec = oi.UpscaleModelLoader?.input.required?.model_name;
  const upOpts = Array.isArray(spec?.[0])
    ? (spec![0] as string[])
    : ((spec?.[1] as { options?: string[] } | undefined)?.options ?? []);
  const upModel = upOpts.find((o) => /remacri|ultrasharp|anime|realesrgan/i.test(o)) ?? upOpts[0];
  if (!upModel) throw new Error("No upscale model installed");

  const up = await comfy.uploadImage(output.filename, buffer, "image/png");
  const inputName = up.subfolder ? `${up.subfolder}/${up.name}` : up.name;

  // Replace the txt2img tail (sampler → decode → save) with a TILED refine. Ultimate SD
  // Upscale does the ESRGAN upscale + per-tile img2img (1024 tiles), so it fits VRAM at any
  // factor — a true 2x on a 16GB card that a single full-size pass can't do.
  const saveId = Object.keys(wf).find((id) => /^Save/.test(wf[id]!.class_type));
  for (const id of [emptyId, samplerId, decodeId, saveId]) if (id) delete wf[id];
  wf.enh_load = { class_type: "LoadImage", inputs: { image: inputName }, _meta: { title: "Enhance source" } };
  wf.enh_upm = { class_type: "UpscaleModelLoader", inputs: { model_name: upModel }, _meta: {} };
  wf.enh_usdu = {
    class_type: "UltimateSDUpscale",
    inputs: {
      image: ["enh_load", 0],
      model: modelRef,
      positive: posRef,
      negative: negRef,
      vae: vaeRef,
      upscale_model: ["enh_upm", 0],
      upscale_by: factor,
      seed: randomSeed(),
      steps,
      cfg,
      sampler_name: samplerName,
      scheduler,
      denoise: ENHANCE_DENOISE,
      mode_type: "Linear",
      tile_width: 1024,
      tile_height: 1024,
      mask_blur: 8,
      tile_padding: 32,
      seam_fix_mode: "None",
      seam_fix_denoise: 1,
      seam_fix_width: 64,
      seam_fix_mask_blur: 8,
      seam_fix_padding: 16,
      force_uniform_tiles: true,
      tiled_decode: false,
      batch_size: 1,
    },
    _meta: { title: "Enhance" },
  };
  wf.enh_save = { class_type: "SaveImage", inputs: { filename_prefix: "Latent/Enhanced", images: ["enh_usdu", 0] }, _meta: {} };

  const tw = Math.round(ow * factor);
  const th = Math.round(oh * factor);
  const id = nanoid(12);
  generations.insert({
    id,
    pipelineId: source.pipelineId,
    pipelineName: `Enhance · ${factor}× (${tw}×${th})`,
    pipelineType: "image",
    status: "queued",
    params: { source: generationId, enhance: true, factor, width: tw, height: th } as Record<string, ParamValue>,
    outputs: [],
    favorite: false,
    tags: [],
    createdAt: new Date().toISOString(),
  });
  try {
    const promptId = await comfy.queuePrompt(wf, bridge.clientId);
    bridge.track(promptId, id);
    const updated = generations.update(id, { status: "running", promptId });
    if (updated) bridge.broadcast({ type: "generation", record: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = generations.update(id, { status: "failed", error: message, completedAt: new Date().toISOString() });
    if (failed) bridge.broadcast({ type: "generation", record: failed });
  }
  return id;
}

/**
 * Push a stored generation output back into ComfyUI's input folder so it can be
 * used as a LoadImage source (img2img / video start frame). Returns the input
 * name to store in the target pipeline's image param.
 */
export async function outputToComfyInput(generationId: string): Promise<string> {
  const source = generations.get(generationId);
  const output = source?.outputs.find((o) => o.type === "image");
  if (!source || !output) throw new Error("No source image to reuse");
  const stored = basename(decodeURIComponent(output.url));
  const buffer = await readFile(join(config.dataDir, "outputs", stored));
  const up = await comfy.uploadImage(output.filename, buffer, "image/png");
  return up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
}

export async function runGeneration(req: GenerateRequest): Promise<string[]> {
  const manifest = workflows.get(req.pipelineId);
  if (!manifest) throw new Error(`Unknown pipeline: ${req.pipelineId}`);

  // Batch builder: one run per override set; otherwise `batch` identical runs.
  const runs = req.runs && req.runs.length > 0 ? req.runs.slice(0, 256) : null;
  const batch = runs ? runs.length : Math.max(1, Math.min(req.batch ?? 1, 64));
  const sKeys = seedKeys(manifest);
  const promptKeys = manifest.params.filter((p) => p.control === "textarea").map((p) => p.key);
  const seedMode = req.seedMode ?? "random";
  const baseSeed =
    sKeys.length > 0 && typeof req.values[sKeys[0]!] === "number"
      ? (req.values[sKeys[0]!] as number)
      : randomSeed();

  const ids: string[] = [];

  for (let i = 0; i < batch; i++) {
    const values: Record<string, ParamValue> = { ...req.values, ...(runs ? runs[i] : {}) };

    // In raw mode the graph is submitted verbatim, so per-job seed injection and
    // wildcard expansion don't apply — skip them (and don't claim a seed we
    // didn't set) so the stored record matches what actually ran.
    let jobSeed: number | undefined;
    if (!req.rawWorkflow) {
      if (sKeys.length > 0) {
        jobSeed =
          seedMode === "fixed"
            ? baseSeed
            : seedMode === "increment"
              ? baseSeed + i
              : randomSeed();
        for (const key of sKeys) values[key] = jobSeed;
      }
      // Expand prompt wildcards per job (so a batch rolls different values). The
      // expanded text is what we store + submit, so the gallery shows what ran.
      for (const key of promptKeys) {
        if (typeof values[key] === "string") values[key] = expandWildcards(values[key] as string);
      }
    }

    const workflow = req.rawWorkflow ?? buildWorkflow(manifest, values);
    const id = nanoid(12);
    const now = new Date().toISOString();

    const record: GenerationRecord = {
      id,
      pipelineId: manifest.id,
      pipelineName: manifest.name,
      pipelineType: manifest.type,
      status: "queued",
      seed: jobSeed,
      params: values,
      outputs: [],
      favorite: false,
      tags: [],
      createdAt: now,
    };
    generations.insert(record);

    try {
      const promptId = await comfy.queuePrompt(workflow, bridge.clientId);
      bridge.track(promptId, id);
      const updated = generations.update(id, { status: "running", promptId });
      if (updated) bridge.broadcast({ type: "generation", record: updated });
      ids.push(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = generations.update(id, {
        status: "failed",
        error: message,
        completedAt: new Date().toISOString(),
      });
      if (failed) bridge.broadcast({ type: "generation", record: failed });
      ids.push(id);
    }
  }

  return ids;
}
