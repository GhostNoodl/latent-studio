import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { nanoid } from "nanoid";
import { settings } from "./db.ts";
import type { CustomModelPath, ModelKind } from "@latent/shared";

/**
 * User-added filesystem folders that Latent + the managed ComfyUI also search for
 * models (persisted as a JSON blob in the settings table). Kept free of catalog /
 * comfy-env imports so those can depend on it without a cycle.
 */
const KEY = "customModelPaths";
const MODEL_EXTS = new Set([".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".sft", ".bin", ".onnx"]);

export function getCustomModelPaths(): CustomModelPath[] {
  try {
    const parsed = JSON.parse(settings.get(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as CustomModelPath[]) : [];
  } catch {
    return [];
  }
}

export function setCustomModelPaths(paths: CustomModelPath[]): void {
  // Normalize: ensure ids, drop empties.
  const clean = paths
    .filter((p) => p && typeof p.path === "string" && p.path.trim())
    .map((p) => ({
      id: p.id || nanoid(8),
      path: p.path.trim(),
      kind: p.kind,
      ...(p.label ? { label: p.label } : {}),
    }));
  settings.set(KEY, JSON.stringify(clean));
}

// Folder-name → model kind, across the common conventions (ComfyUI / A1111 / SM).
// Names are normalized (lowercased, separators stripped) before lookup.
const KIND_BY_DIRNAME: Record<string, ModelKind> = {
  checkpoints: "checkpoint",
  checkpoint: "checkpoint",
  stablediffusion: "checkpoint",
  ckpt: "checkpoint",
  lora: "lora",
  loras: "lora",
  lycoris: "lora",
  locon: "lora",
  vae: "vae",
  vaes: "vae",
  controlnet: "controlnet",
  t2iadapter: "controlnet",
  esrgan: "upscale",
  realesrgan: "upscale",
  upscalemodels: "upscale",
  upscale: "upscale",
  upscalers: "upscale",
  swinir: "upscale",
  embeddings: "embedding",
  embedding: "embedding",
  textualinversion: "embedding",
  diffusionmodels: "diffusion",
  unet: "diffusion",
};
const kindForDirName = (name: string): ModelKind | null =>
  KIND_BY_DIRNAME[name.toLowerCase().replace(/[\s_-]/g, "")] ?? null;

function countModels(dir: string): number {
  let count = 0;
  try {
    for (const f of readdirSync(dir, { recursive: true }) as string[]) {
      if (MODEL_EXTS.has(extname(String(f)).toLowerCase()) && ++count > 4096) break;
    }
  } catch {
    /* unreadable */
  }
  return count;
}

/**
 * Walk a "home" folder and auto-detect model subfolders by their name, so a user
 * can add a whole scattered library in one go instead of one folder at a time.
 * Depth- and visit-capped so it stays fast even on a big tree.
 */
export function detectModelDirs(home: string): { path: string; kind: ModelKind; count: number }[] {
  if (!home || !existsSync(home)) return [];
  const found: { path: string; kind: ModelKind; count: number }[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: home, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 2000) {
    const { dir, depth } = queue.shift()!;
    visited++;
    const kind = kindForDirName(basename(dir));
    if (kind) {
      const count = countModels(dir);
      if (count > 0) found.push({ path: dir, kind, count });
      continue; // a matched kind folder — its contents are models, don't recurse in
    }
    if (depth >= 3) continue;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) queue.push({ dir: join(dir, e.name), depth: depth + 1 });
      }
    } catch {
      /* unreadable */
    }
  }
  return found;
}

/** Parent of a path, or "" when already at a drive root (→ show the drive list). */
function parentDir(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:$/.test(trimmed)) return ""; // "C:" → drive list
  const up = dirname(trimmed);
  return up === trimmed ? "" : up;
}

/**
 * List the immediate subdirectories of a path for the folder-picker UI — or the
 * drive roots (C:\, D:\, …) when the path is empty. Hidden/system entries and
 * unreadable folders are skipped; the user can always navigate back up via `parent`.
 */
export function listDirectories(dirPath: string): {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
} {
  const p = (dirPath ?? "").trim();
  if (!p) {
    const dirs: { name: string; path: string }[] = [];
    for (let c = 65; c <= 90; c++) {
      const root = `${String.fromCharCode(c)}:\\`;
      if (existsSync(root)) dirs.push({ name: root, path: root });
    }
    return { path: "", parent: null, dirs };
  }
  const dirs: { name: string; path: string }[] = [];
  try {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("$")) continue;
      dirs.push({ name: e.name, path: join(p, e.name) });
    }
  } catch {
    /* unreadable — return an empty list but still allow navigating up */
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { path: p, parent: parentDir(p), dirs };
}

/** Validate a folder for the UI: does it exist, and roughly how many model files? */
export function validateModelPath(path: string): { exists: boolean; modelCount: number } {
  if (!path || !existsSync(path)) return { exists: false, modelCount: 0 };
  let count = 0;
  try {
    for (const f of readdirSync(path, { recursive: true }) as string[]) {
      if (MODEL_EXTS.has(extname(String(f)).toLowerCase())) count++;
      if (count > 4096) break; // don't walk forever on huge trees
    }
  } catch {
    /* unreadable — treat as 0 */
  }
  return { exists: true, modelCount: count };
}
