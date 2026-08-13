import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { basename, dirname, extname, join, parse } from "node:path";
import { config } from "./config.ts";
import { modelMeta } from "./db.ts";
import { getCustomModelPaths } from "./model-paths.ts";
import type { ModelInfo, ModelKind } from "@latent/shared";

/**
 * Builds a catalog of installed models enriched with Stability Matrix's local
 * Civitai metadata (`<model>.cm-info.json` + `<model>.preview.*`). Keyed by the
 * filename exactly as ComfyUI's /object_info reports it, so the frontend can join
 * a model dropdown's options to clean names, thumbnails, and trigger words.
 */

const MODEL_EXTS = new Set([
  ".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".sft", ".bin", ".onnx",
]);

// ComfyUI model category → Stability Matrix Models subfolders.
export const KIND_FOLDERS: Record<ModelKind, string[]> = {
  checkpoint: ["StableDiffusion"],
  diffusion: ["DiffusionModels", "diffusion_models"],
  lora: ["Lora", "LyCORIS"],
  vae: ["VAE"],
  upscale: ["ESRGAN", "RealESRGAN", "upscale_models", "SwinIR"],
  controlnet: ["ControlNet"],
  embedding: ["Embeddings"],
};

interface CatalogEntry extends ModelInfo {
  previewPath?: string;
  /** Absolute path to the model file on disk — the root it was actually found in
   * (smModelsDir OR any custom model path). Deletion uses this so it can remove
   * files wherever they live, not just under smModelsDir. */
  modelPath?: string;
}

const cache = new Map<ModelKind, CatalogEntry[]>();
const byFile = new Map<string, CatalogEntry>(); // `${kind}:${file}` → entry

/** Prettify a raw filename when no Civitai metadata exists. */
function cleanName(base: string): string {
  return base
    .replace(/\.(safetensors|ckpt|pt|pth|gguf|sft|bin|onnx)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s*-\s*/g, " — ")
    .replace(/\s+/g, " ")
    .trim();
}

function prettyModelName(n: string): string {
  return n.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

interface CmInfo {
  ModelName?: string;
  ModelType?: string;
  VersionName?: string;
  BaseModel?: string;
  AuthorUsername?: string;
  TrainedWords?: string[];
  Tags?: string[];
  Nsfw?: boolean;
  ModelId?: number;
  VersionId?: number;
  Stats?: { downloadCount?: number; thumbsUpCount?: number; rating?: number };
}

async function readCmInfo(path: string): Promise<CmInfo | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as CmInfo;
  } catch {
    return null;
  }
}

async function scanKind(kind: ModelKind): Promise<CatalogEntry[]> {
  // Drop any stale byFile entries for this kind (files may have been deleted on
  // disk since the last scan) so a forced re-scan doesn't retain ghosts.
  for (const key of byFile.keys()) if (key.startsWith(`${kind}:`)) byFile.delete(key);
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>(); // dedup mirrored folders within this scan
  // Persisted Civitai enrichments to overlay onto metadata-less models.
  const saved = new Map(
    modelMeta
      .all()
      .filter((m) => m.kind === kind)
      .map((m) => [m.file, m.data]),
  );
  // Category roots to scan: the main models dir's subfolders, plus any user-added
  // custom folders (a "root" folder contributes its subfolders; a single-kind
  // folder contributes itself directly).
  const roots = KIND_FOLDERS[kind].map((f) => join(config.smModelsDir, f));
  for (const p of getCustomModelPaths()) {
    if (p.kind === "root") for (const f of KIND_FOLDERS[kind]) roots.push(join(p.path, f));
    else if (p.kind === kind) roots.push(p.path);
  }
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let files: string[];
    try {
      files = (await readdir(root, { recursive: true })) as string[];
    } catch {
      continue;
    }
    const available = new Set(files.map((file) => String(file).replace(/\\/g, "/")));
    for (const rel of files) {
      const relPath = String(rel);
      const { ext, dir, name } = parse(relPath);
      if (!MODEL_EXTS.has(ext.toLowerCase())) continue;

      // Key as ComfyUI reports it: relative to the category root, forward slashes.
      const file = relPath.replace(/\\/g, "/");
      // Some categories map to multiple folders that mirror each other
      // (e.g. DiffusionModels + diffusion_models) — keep one entry per file.
      if (seen.has(file)) continue;
      seen.add(file);
      const absPath = join(root, relPath); // exact on-disk location, for deletion
      const sidecarBase = join(root, dir, name);
      const sidecarRel = `${join(dir, name).replace(/\\/g, "/")}.cm-info.json`;
      const cm = available.has(sidecarRel)
        ? await readCmInfo(`${sidecarBase}.cm-info.json`)
        : null;
      const previewSuffix = [".preview.jpeg", ".preview.jpg", ".preview.png", ".preview.webp"]
        .find((suffix) => available.has(`${join(dir, name).replace(/\\/g, "/")}${suffix}`));
      const previewPath = previewSuffix ? `${sidecarBase}${previewSuffix}` : undefined;

      const entry: CatalogEntry = cm
        ? {
            file,
            kind,
            name: prettyModelName(cm.ModelName ?? name),
            versionName: cm.VersionName ?? undefined,
            baseModel: cm.BaseModel ?? undefined,
            modelType: cm.ModelType ?? undefined,
            author: cm.AuthorUsername ?? undefined,
            trainedWords: (cm.TrainedWords ?? []).map((w) => w.replace(/,\s*$/, "").trim()).filter(Boolean),
            tags: cm.Tags ?? undefined,
            nsfw: cm.Nsfw ?? undefined,
            civitaiModelId: cm.ModelId ?? undefined,
            civitaiVersionId: cm.VersionId ?? undefined,
            stats: cm.Stats
              ? {
                  downloadCount: cm.Stats.downloadCount,
                  thumbsUpCount: cm.Stats.thumbsUpCount,
                  rating: cm.Stats.rating,
                }
              : undefined,
            hasPreview: Boolean(previewPath),
            source: "local",
            previewPath,
            modelPath: absPath,
          }
        : {
            file,
            kind,
            name: cleanName(name),
            hasPreview: Boolean(previewPath),
            source: "none",
            previewPath,
            modelPath: absPath,
          };

      // Overlay a persisted Civitai enrichment if we have one for this file.
      const savedMeta = saved.get(file);
      if (savedMeta && entry.source !== "local") {
        Object.assign(entry, savedMeta, { source: "civitai" as const });
      }

      entries.push(entry);
      byFile.set(`${kind}:${file}`, entry);
    }
  }
  return entries;
}

const scans = new Map<ModelKind, Promise<CatalogEntry[]>>();

async function ensureKind(kind: ModelKind, force = false): Promise<CatalogEntry[]> {
  if (force) {
    cache.delete(kind);
    scans.delete(kind);
  }
  const cached = cache.get(kind);
  if (cached) return cached;
  let scan = scans.get(kind);
  if (!scan) {
    scan = scanKind(kind)
      .then((entries) => {
        cache.set(kind, entries);
        return entries;
      })
      .finally(() => scans.delete(kind));
    scans.set(kind, scan);
  }
  return scan;
}

export const catalog = {
  async list(kind: ModelKind, force = false): Promise<ModelInfo[]> {
    const entries = await ensureKind(kind, force);
    return entries.map(({ previewPath: _p, modelPath: _m, ...info }) => info);
  },

  /** Absolute preview-image path for a model, if one exists. */
  async previewPath(kind: ModelKind, file: string): Promise<string | undefined> {
    await ensureKind(kind);
    return byFile.get(`${kind}:${file}`)?.previewPath;
  },

  async get(kind: ModelKind, file: string): Promise<CatalogEntry | undefined> {
    await ensureKind(kind);
    return byFile.get(`${kind}:${file}`);
  },

  /** Merge a Civitai enrichment over a (usually metadata-less) entry. */
  async applyEnrichment(kind: ModelKind, file: string, patch: Partial<ModelInfo>): Promise<ModelInfo | undefined> {
    const entry = await catalog.get(kind, file);
    if (!entry) return undefined;
    Object.assign(entry, patch, { source: "civitai" as const });
    const { previewPath: _p, modelPath: _m, ...info } = entry;
    return info;
  },

  refresh(): void {
    cache.clear();
    byFile.clear();
    scans.clear();
  },

  warm(): void {
    void (async () => {
      for (const kind of Object.keys(KIND_FOLDERS) as ModelKind[]) await ensureKind(kind);
    })();
  },

  /**
   * Permanently delete a model file + its sidecars from disk, then re-scan.
   * Uses the entry's recorded absolute path, so it removes the file wherever it
   * actually lives — smModelsDir OR any custom model path (e.g. C:\Latent\Models).
   * Returns true if a file was removed.
   */
  async deleteFile(kind: ModelKind, file: string): Promise<boolean> {
    const modelPath = (await catalog.get(kind, file))?.modelPath; // get() ensures a scan
    if (!modelPath || !existsSync(modelPath)) return false;
    const dir = dirname(modelPath);
    const base = basename(modelPath, extname(modelPath));
    await rm(modelPath, { force: true });
    for (const suffix of [
      ".cm-info.json",
      ".preview.jpeg",
      ".preview.jpg",
      ".preview.png",
      ".preview.webp",
    ]) {
      await rm(join(dir, base + suffix), { force: true });
    }
    await catalog.list(kind, true); // re-scan this kind
    return true;
  },
};
