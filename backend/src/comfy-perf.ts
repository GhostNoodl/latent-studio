import { settings } from "./db.ts";

export type VramMode = "off" | "balanced" | "aggressive";

/** The user's VRAM-saving mode (persisted). Default off = full quality. */
export function getVramMode(): VramMode {
  const v = settings.get("vramMode");
  return v === "balanced" || v === "aggressive" ? v : "off";
}
export function setVramMode(mode: VramMode): void {
  settings.set("vramMode", mode);
}

/**
 * Performance / VRAM launch flags appended to every managed ComfyUI start.
 * - `--fast` is always on: enables Ada fp8/fp16 acceleration (faster, negligible
 *   quality impact) — a free win on this class of GPU.
 * - "balanced" adds `--fp8_e4m3fn-unet`: loads the UNet in fp8, freeing ~2.5–3 GB of
 *   VRAM with a tiny precision cost.
 * - "aggressive" also adds `--lowvram`: offloads the model between steps — big VRAM
 *   savings, noticeably slower. For squeezing a heavy job onto a small card.
 */
export function perfArgs(): string[] {
  const args = ["--fast"];
  const mode = getVramMode();
  if (mode === "balanced" || mode === "aggressive") args.push("--fp8_e4m3fn-unet");
  if (mode === "aggressive") args.push("--lowvram");
  return args;
}

/** Extra process env for ComfyUI — expandable CUDA segments reduce VRAM
 *  fragmentation, so more fits before an out-of-memory (free, no downside). */
export function perfEnv(): Record<string, string> {
  return { PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True" };
}
