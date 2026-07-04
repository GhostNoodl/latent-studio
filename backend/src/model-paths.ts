import { existsSync, readdirSync } from "node:fs";
import { extname } from "node:path";
import { nanoid } from "nanoid";
import { settings } from "./db.ts";
import type { CustomModelPath } from "@latent/shared";

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
