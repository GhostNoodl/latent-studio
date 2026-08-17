import { settings } from "./db.ts";
import type {
  ComfyPerformanceSettings,
  ComfyPreviewMode,
  ComfyRuntimeMode,
  VramMode,
} from "@latent/shared";

export function getVramMode(): VramMode {
  const value = settings.get("vramMode");
  return value === "balanced" || value === "aggressive" ? value : "off";
}

export function getRuntimeMode(): ComfyRuntimeMode {
  const value = settings.get("comfyRuntimeMode");
  return value === "stable" || value === "experimental" ? value : "fast";
}

export function getPreviewMode(): ComfyPreviewMode {
  const value = settings.get("comfyPreviewMode");
  return value === "light" || value === "off" ? value : "full";
}

export function getPerformanceSettings(): ComfyPerformanceSettings {
  return { runtime: getRuntimeMode(), preview: getPreviewMode(), vram: getVramMode() };
}

export function setPerformanceSettings(value: Partial<ComfyPerformanceSettings>): void {
  if (value.runtime) settings.set("comfyRuntimeMode", value.runtime);
  if (value.preview) settings.set("comfyPreviewMode", value.preview);
  if (value.vram) settings.set("vramMode", value.vram);
}

export function setVramMode(mode: VramMode): void {
  setPerformanceSettings({ vram: mode });
}

/** Build managed ComfyUI flags for independently chosen math, preview, and VRAM policies. */
export function buildPerfArgs(profile: ComfyPerformanceSettings): string[] {
  const args: string[] = [];
  if (profile.preview === "off") args.push("--preview-method", "none");
  else {
    args.push("--preview-method", "auto");
    if (profile.preview === "light") args.push("--preview-size", "256");
  }
  if (profile.vram === "balanced" || profile.vram === "aggressive") {
    args.push("--fp8_e4m3fn-unet");
  }
  if (profile.vram === "aggressive") args.push("--lowvram");
  // Bare --fast enables every experimental feature, including fp8 matrix math
  // and autotune. The recommended profile deliberately opts into a smaller set.
  if (profile.runtime === "fast") args.push("--fast", "fp16_accumulation", "cublas_ops");
  if (profile.runtime === "experimental") args.push("--fast");
  return args;
}

export function perfArgs(): string[] {
  return buildPerfArgs(getPerformanceSettings());
}

/** Expandable CUDA segments reduce fragmentation without changing model output. */
export function perfEnv(): Record<string, string> {
  return { PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True" };
}
