import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config.ts";
import { comfy } from "./comfy.ts";
import { workflows, generations } from "./db.ts";
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
