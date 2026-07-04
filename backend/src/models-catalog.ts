import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, parse } from "node:path";
import { config } from "./config.ts";
import { modelMeta } from "./db.ts";
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

function readCmInfo(path: string): CmInfo | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CmInfo;
  } catch {
    return null;
  }
}

function scanKind(kind: ModelKind): CatalogEntry[] {
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
  for (const folder of KIND_FOLDERS[kind]) {
    const root = join(config.smModelsDir, folder);
    if (!existsSync(root)) continue;
    let files: string[];
    try {
      files = readdirSync(root, { recursive: true }) as string[];
    } catch {
      continue;
    }
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
      const sidecarBase = join(root, dir, name);
      const cm = existsSync(`${sidecarBase}.cm-info.json`)
        ? readCmInfo(`${sidecarBase}.cm-info.json`)
        : null;
      const previewPath = [".preview.jpeg", ".preview.jpg", ".preview.png", ".preview.webp"]
        .map((suffix) => `${sidecarBase}${suffix}`)
        .find((p) => existsSync(p));

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
          }
        : {
            file,
            kind,
            name: cleanName(name),
            hasPreview: Boolean(previewPath),
            source: "none",
            previewPath,
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

export const catalog = {
  list(kind: ModelKind, force = false): ModelInfo[] {
    if (!cache.has(kind) || force) cache.set(kind, scanKind(kind));
    return cache.get(kind)!.map(({ previewPath: _p, ...info }) => info);
  },

  /** Absolute preview-image path for a model, if one exists. */
  previewPath(kind: ModelKind, file: string): string | undefined {
    if (!cache.has(kind)) catalog.list(kind);
    return byFile.get(`${kind}:${file}`)?.previewPath;
  },

  get(kind: ModelKind, file: string): CatalogEntry | undefined {
    if (!cache.has(kind)) catalog.list(kind);
    return byFile.get(`${kind}:${file}`);
  },

  /** Merge a Civitai enrichment over a (usually metadata-less) entry. */
  applyEnrichment(kind: ModelKind, file: string, patch: Partial<ModelInfo>): ModelInfo | undefined {
    const entry = catalog.get(kind, file);
    if (!entry) return undefined;
    Object.assign(entry, patch, { source: "civitai" as const });
    const { previewPath: _p, ...info } = entry;
    return info;
  },

  refresh(): void {
    cache.clear();
    byFile.clear();
  },

  /**
   * Permanently delete a model file + its sidecars from disk, then re-scan.
   * Searches every folder mapped to the kind (mirrored dirs). Returns true if a
   * file was removed.
   */
  deleteFile(kind: ModelKind, file: string): boolean {
    for (const folder of KIND_FOLDERS[kind]) {
      const modelPath = join(config.smModelsDir, folder, file);
      if (!existsSync(modelPath)) continue;
      const dir = dirname(modelPath);
      const base = basename(file, extname(file));
      rmSync(modelPath, { force: true });
      for (const suffix of [
        ".cm-info.json",
        ".preview.jpeg",
        ".preview.jpg",
        ".preview.png",
        ".preview.webp",
      ]) {
        rmSync(join(dir, base + suffix), { force: true });
      }
      catalog.list(kind, true); // re-scan this kind
      return true;
    }
    return false;
  },
};
