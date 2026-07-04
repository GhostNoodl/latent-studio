import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Absolute data dir for the SQLite DB + copied outputs + (by default) models/tags. */
const dataDir = resolve(repoRoot, process.env.DATA_DIR ?? "data");

export const config = {
  /** ComfyUI REST/WS origin, e.g. http://127.0.0.1:8188 */
  comfyUrl: trimTrailingSlash(process.env.COMFYUI_URL ?? "http://127.0.0.1:8188"),
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir,
  /** Optional LAN access token; empty string disables auth. */
  accessToken: process.env.ACCESS_TOKEN ?? "",
  /**
   * Stop Latent + its ComfyUI when the last browser tab closes. On for the real
   * (hidden-window) launch; off in dev so closing a tab doesn't kill the server.
   */
  autoShutdown: process.env.AUTO_SHUTDOWN === "1" || process.env.AUTO_SHUTDOWN === "true",
  /** Static SPA build dir (served in production). */
  frontendDist: resolve(repoRoot, "frontend", "dist"),
  /** Models root. Self-contained under the data dir by default; SM_MODELS_DIR overrides
   *  (e.g. point it at a shared model library outside the app). */
  smModelsDir: process.env.SM_MODELS_DIR ?? resolve(dataDir, "models"),
  /** OPTIONAL Stability Matrix root — only set if you want Latent to drive an existing SM
   *  ComfyUI instead of its own managed portable. Empty = use the managed portable. */
  smDir: process.env.STABILITY_MATRIX_DIR ?? "",
  /** OPTIONAL external ComfyUI package dir (an SM venv with main.py). Empty = managed portable. */
  comfyDir:
    process.env.COMFYUI_DIR ??
    (process.env.STABILITY_MATRIX_DIR
      ? `${process.env.STABILITY_MATRIX_DIR}\\Packages\\ComfyUI`
      : ""),
  /** Tag-autocomplete CSV (danbooru/e621). OPTIONAL — autocomplete degrades gracefully if absent.
   *  Defaults under the data dir; TAGS_CSV overrides. */
  tagsCsv: process.env.TAGS_CSV ?? resolve(dataDir, "tags", "danbooru_e621_merged.csv"),
  /** Wildcards directory (`__name__` expansion). Defaults under the data dir. */
  wildcardsDir: resolve(repoRoot, process.env.WILDCARDS_DIR ?? "data/wildcards"),
} as const;

/** ComfyUI WebSocket URL for a given client id. */
export function comfyWsUrl(clientId: string): string {
  const ws = config.comfyUrl.replace(/^http/, "ws");
  return `${ws}/ws?clientId=${encodeURIComponent(clientId)}`;
}
