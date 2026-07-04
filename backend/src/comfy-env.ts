import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { config } from "./config.ts";
import { comfy } from "./comfy.ts";
import { bridge } from "./ws-bridge.ts";
import { KIND_FOLDERS } from "./models-catalog.ts";
import { getCustomModelPaths } from "./model-paths.ts";
import type { GpuInfo, ModelKind, SetupStatus } from "@latent/shared";

/**
 * First-run ComfyUI provisioning: detect the GPU, download the official Windows
 * portable (embedded Python + torch, no system Python needed), extract it,
 * launch it, and install the custom nodes the bundled pipelines need. Lets
 * someone run Latent with no ComfyUI installed. Windows-first.
 */

const require = createRequire(import.meta.url);
const { path7za } = require("7zip-bin") as { path7za: string };
const exec = promisify(execFile);

const RELEASES_API = "https://api.github.com/repos/Comfy-Org/ComfyUI/releases/latest";

// The portable doesn't bundle ComfyUI-Manager — clone it first (cm-cli drives node installs).
const MANAGER_URL = "https://github.com/Comfy-Org/ComfyUI-Manager.git";

// Custom-node packs the bundled Illustrious + WAN pipelines rely on (git URLs).
const PIPELINE_NODE_URLS = [
  "https://github.com/rgthree/rgthree-comfy",
  "https://github.com/yolain/ComfyUI-Easy-Use",
  "https://github.com/Smirnov75/ComfyUI-mxToolkit",
  "https://github.com/city96/ComfyUI-GGUF",
  "https://github.com/kijai/ComfyUI-KJNodes",
  "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite",
  "https://github.com/darksidewalker/ComfyUI-DaSiWa-Nodes",
  "https://github.com/Lightricks/ComfyUI-LTXVideo",
  "https://github.com/evanspearman/ComfyMath",
  "https://github.com/GACLove/ComfyUI-VFI",
  "https://github.com/WhatDreamscost/WhatDreamsCost-ComfyUI",
  // ControlNet preprocessors (canny/depth/lineart/pose/…) for the ControlNet flow.
  "https://github.com/Fannovel16/comfyui_controlnet_aux",
  // Impact Pack (+ Subpack) — yolo detectors for smart auto-masking (face/hand/person).
  "https://github.com/ltdrdata/ComfyUI-Impact-Pack",
  "https://github.com/ltdrdata/ComfyUI-Impact-Subpack",
];

// Deps that don't install cleanly on the fresh embedded Python via node requirements
// alone (discovered during manual setup): cv2, gguf, accelerate, and a kornia pin —
// 0.8.x drops kornia.geometry.transform.pyramid.pad that LTXVideo imports.
// controlnet_aux deps: onnxruntime (DWPose) + scikit-image + config libs. Deliberately
// NOT mediapipe — it has no cp313 wheel on this portable's Python and DWPose covers pose.
const EXTRA_PIP = [
  "opencv-python",
  "gguf",
  "accelerate",
  "kornia==0.7.4",
  "onnxruntime",
  "scikit-image",
  "addict",
  "yacs",
  "omegaconf",
  "yapf",
  "ftfy",
  "fvcore",
  // Impact Pack deps for auto-masking (yolo detect). ultralytics is the big one;
  // segment_anything is a hard import in impact.core even for the yolo path.
  "ultralytics>=8.3.162",
  "dill",
  "piexif",
  "segment-anything",
];

// ── Managed install paths (a Latent-owned portable under the data dir) ────────
const installRoot = join(config.dataDir, "comfyui");
const portableDir = join(installRoot, "ComfyUI_windows_portable");
const embeddedPython = join(portableDir, "python_embeded", "python.exe");
const mainPy = join(portableDir, "ComfyUI", "main.py");
const comfyCwd = join(portableDir, "ComfyUI");
const cmCli = join(portableDir, "ComfyUI", "custom_nodes", "ComfyUI-Manager", "cm-cli.py");

function isInstalled(): boolean {
  return existsSync(embeddedPython) && existsSync(mainPy);
}

// ── Share existing model folders with the managed ComfyUI ─────────────────────
// Maps our kinds → ComfyUI's model-type keys; folders come from KIND_FOLDERS.
const COMFY_KEY: Record<ModelKind, string> = {
  checkpoint: "checkpoints",
  diffusion: "diffusion_models",
  lora: "loras",
  vae: "vae",
  upscale: "upscale_models",
  controlnet: "controlnet",
  embedding: "embeddings",
};

/** Emit a full models-tree block (all kinds, subfolders relative to base_path). */
function writeRootBlock(lines: string[], name: string, basePath: string): void {
  lines.push(`${name}:`, `  base_path: ${basePath}`);
  const entry = (key: string, folders: string[]) => {
    if (folders.length === 1) lines.push(`  ${key}: ${folders[0]}`);
    else {
      lines.push(`  ${key}: |`);
      for (const f of folders) lines.push(`    ${f}`);
    }
  };
  for (const [kind, folders] of Object.entries(KIND_FOLDERS) as [ModelKind, string[]][]) {
    entry(COMFY_KEY[kind], folders);
    if (kind === "diffusion") entry("unet", folders); // ComfyUI uses both keys
  }
  // Model types beyond our 7 catalog kinds that pipelines still reference (text
  // encoders for CLIPLoader, clip vision, IP-Adapter, etc.). Missing folders are ignored.
  entry("clip", ["TextEncoders"]);
  entry("text_encoders", ["TextEncoders"]);
  entry("clip_vision", ["ClipVision"]);
  entry("ipadapter", ["IpAdapter", "IpAdapters15", "IpAdaptersXl"]);
  entry("gligen", ["GLIGEN"]);
  entry("vae_approx", ["ApproxVAE"]);
  entry("hypernetworks", ["Hypernetwork"]);
  entry("style_models", ["StyleModels", "style_models"]);
  entry("ultralytics_bbox", ["Ultralytics/bbox"]);
  entry("ultralytics_segm", ["Ultralytics/segm"]);
  entry("ultralytics", ["Ultralytics"]);
  entry("frame_interpolation", ["frame_interpolation"]);
}

/** Emit a single-kind block — the folder itself IS that kind's directory. */
function writeKindBlock(lines: string[], name: string, basePath: string, kind: ModelKind): void {
  lines.push(`${name}:`, `  base_path: ${basePath}`, `  ${COMFY_KEY[kind]}: .`);
  if (kind === "diffusion") lines.push(`  unet: .`);
}

/** Build a ComfyUI `extra_model_paths.yaml` for the main models root + any custom folders. */
export function buildExtraModelPathsYaml(): string {
  const lines = ["# Written by Latent — lets the managed ComfyUI use your models."];
  if (existsSync(config.smModelsDir)) writeRootBlock(lines, "latent", config.smModelsDir);
  getCustomModelPaths().forEach((p, i) => {
    if (!existsSync(p.path)) return; // skip folders that aren't present
    if (p.kind === "root") writeRootBlock(lines, `latent_custom_${i}`, p.path);
    else writeKindBlock(lines, `latent_custom_${i}`, p.path, p.kind);
  });
  return lines.join("\n") + "\n";
}

/** Write extra_model_paths.yaml into the managed ComfyUI (main root and/or custom folders). */
export function writeExtraModelPaths(): void {
  if (!isInstalled()) return;
  const custom = getCustomModelPaths();
  if (!existsSync(config.smModelsDir) && !custom.some((p) => existsSync(p.path))) return;
  writeFileSync(join(comfyCwd, "extra_model_paths.yaml"), buildExtraModelPathsYaml());
}

// ── GPU detection ─────────────────────────────────────────────────────────────
async function detectGpu(): Promise<GpuInfo> {
  try {
    const { stdout } = await exec(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 6000 },
    );
    const [name, vram] = stdout.split("\n")[0]!.split(",").map((s) => s.trim());
    return { vendor: "nvidia", name, vramMb: Number(vram) || undefined };
  } catch {
    /* not NVIDIA */
  }
  try {
    const { stdout } = await exec("wmic", ["path", "win32_VideoController", "get", "name"], {
      timeout: 6000,
    });
    if (/radeon|\bamd\b/i.test(stdout)) return { vendor: "amd", name: firstGpuLine(stdout) };
    if (/intel.*(arc|graphics)/i.test(stdout)) return { vendor: "intel", name: firstGpuLine(stdout) };
  } catch {
    /* fall through */
  }
  return { vendor: "cpu" };
}

function firstGpuLine(wmicOut: string): string | undefined {
  return wmicOut
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "name")[0];
}

function assetForVendor(vendor: GpuInfo["vendor"]): string {
  switch (vendor) {
    case "amd":
      return "ComfyUI_windows_portable_amd.7z";
    case "intel":
      return "ComfyUI_windows_portable_intel.7z";
    default:
      return "ComfyUI_windows_portable_nvidia.7z"; // nvidia + cpu fallback
  }
}

interface Release {
  tag: string;
  asset: string;
  url: string;
  sizeBytes: number;
}

async function resolveRelease(vendor: GpuInfo["vendor"]): Promise<Release> {
  const res = await fetch(RELEASES_API, {
    headers: { accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub releases ${res.status}`);
  const json = (await res.json()) as {
    tag_name: string;
    assets: { name: string; size: number; browser_download_url: string }[];
  };
  const asset = assetForVendor(vendor);
  const a = json.assets.find((x) => x.name === asset);
  if (!a) throw new Error(`Release ${json.tag_name} has no asset ${asset}`);
  return { tag: json.tag_name, asset, url: a.browser_download_url, sizeBytes: a.size };
}

// ── Setup state (broadcast on change) ─────────────────────────────────────────
let state: SetupStatus = { comfyReachable: false, managedInstalled: false, phase: "idle" };
let running = false;

function emit(patch: Partial<SetupStatus>): void {
  state = { ...state, ...patch };
  bridge.broadcast({ type: "setup", status: state });
}

export const comfyEnv = {
  async status(): Promise<SetupStatus> {
    const comfyReachable = await comfy.ping();
    const managedInstalled = isInstalled();
    const gpu = state.gpu ?? (await detectGpu());
    let release = state.release;
    if (!release) {
      try {
        const r = await resolveRelease(gpu.vendor);
        release = { tag: r.tag, asset: r.asset, sizeBytes: r.sizeBytes };
      } catch {
        /* offline — leave release undefined */
      }
    }
    state = { ...state, comfyReachable, managedInstalled, gpu, release };
    return state;
  },

  /** Download → extract → launch → install nodes. Idempotent while running. */
  async bootstrap(force = false): Promise<void> {
    if (running) return;
    // Guard: never re-download multi-GB if a managed ComfyUI is already installed or
    // one is already reachable — unless the caller explicitly asked to reinstall.
    if (!force && (isInstalled() || (await comfy.ping()))) {
      emit({
        phase: "ready",
        managedInstalled: isInstalled(),
        comfyReachable: await comfy.ping(),
        message: "ComfyUI is already set up — skipped download.",
      });
      return;
    }
    running = true;
    try {
      const gpu = state.gpu ?? (await detectGpu());
      emit({ gpu, phase: "downloading", error: undefined, message: undefined });
      const rel = await resolveRelease(gpu.vendor);
      emit({ release: { tag: rel.tag, asset: rel.asset, sizeBytes: rel.sizeBytes } });

      mkdirSync(installRoot, { recursive: true });
      const archive = join(installRoot, rel.asset);
      await downloadTo(rel.url, archive, (received, total) => emit({ received, total }));

      emit({ phase: "extracting", message: "Unpacking ~6 GB…" });
      await extract7z(archive, installRoot);
      rmSync(archive, { force: true });
      if (!isInstalled()) throw new Error("Extracted archive missing the expected ComfyUI layout");

      writeExtraModelPaths(); // point ComfyUI at the models root

      // Install nodes BEFORE launching so they load on the first boot (no restart needed).
      emit({ phase: "installing-nodes", message: "Installing custom nodes…" });
      await installNodes();

      emit({ phase: "launching", message: "Starting ComfyUI…" });
      launchManaged(gpu);
      await waitForComfy(180_000);

      emit({ phase: "ready", managedInstalled: true, comfyReachable: true, message: undefined });
    } catch (err) {
      emit({ phase: "failed", error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  },

  /** Manually launch an already-installed managed ComfyUI. */
  launch(): boolean {
    if (!isInstalled()) return false;
    writeExtraModelPaths();
    launchManaged(state.gpu ?? { vendor: "nvidia" });
    return true;
  },

  /**
   * On app start: if we manage a ComfyUI and nothing is already reachable
   * (e.g. Stability Matrix isn't running), boot our managed one.
   */
  async autostart(): Promise<void> {
    if (!isInstalled()) return;
    if (await comfy.ping()) return;
    writeExtraModelPaths();
    launchManaged(state.gpu ?? (await detectGpu()));
  },

  isInstalled,
};

async function downloadTo(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    const now = Date.now();
    if (now - last > 500) {
      last = now;
      onProgress(received, total);
    }
  });
  await pipeline(body, createWriteStream(dest));
  onProgress(total || received, total);
}

function extract7z(archive: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(path7za, ["x", archive, `-o${outDir}`, "-y"], { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`7za exited ${code}`))));
  });
}

function launchManaged(gpu: GpuInfo): void {
  const args = [
    "-s",
    join("ComfyUI", "main.py"),
    "--windows-standalone-build",
    "--disable-auto-launch",
    "--preview-method",
    "auto", // stream live sampling previews to the result canvas
    "--reserve-vram",
    "0.9", // VRAM headroom so tight cards don't OOM mid-sample
    "--use-pytorch-cross-attention",
    "--enable-manager",
  ];
  if (gpu.vendor === "cpu") args.push("--cpu");
  const child = spawn(embeddedPython, args, {
    cwd: portableDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function waitForComfy(timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await comfy.ping()) return;
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("ComfyUI did not become reachable in time");
}

async function installNodes(): Promise<void> {
  const cmEnv = { ...process.env, COMFYUI_PATH: comfyCwd };
  const managerDir = join(comfyCwd, "custom_nodes", "ComfyUI-Manager");

  // 1. Ensure ComfyUI-Manager (the portable doesn't ship it).
  if (!existsSync(cmCli)) {
    emit({ message: "Installing ComfyUI-Manager…" });
    try {
      await exec("git", ["clone", "--depth", "1", MANAGER_URL, managerDir], { timeout: 180_000 });
      await exec(
        embeddedPython,
        ["-m", "pip", "install", "--no-warn-script-location", "-r", join(managerDir, "requirements.txt")],
        { cwd: comfyCwd, timeout: 300_000 },
      );
    } catch {
      emit({ message: "Couldn't install ComfyUI-Manager (is git installed?) — add nodes manually." });
      return;
    }
  }

  // 2. Install each pipeline node pack (cm-cli clones + installs its requirements.txt).
  const failed: string[] = [];
  for (const url of PIPELINE_NODE_URLS) {
    const name = url.split("/").pop() ?? url;
    emit({ message: `Installing node: ${name}…` });
    try {
      await exec(embeddedPython, [cmCli, "install", url], { cwd: comfyCwd, env: cmEnv, timeout: 600_000 });
    } catch {
      failed.push(name);
    }
  }

  // 3. Known dependency fixes for the embedded Python (cv2/gguf/accelerate/kornia).
  emit({ message: "Installing runtime dependencies…" });
  try {
    await exec(embeddedPython, ["-m", "pip", "install", "--no-warn-script-location", ...EXTRA_PIP], {
      cwd: comfyCwd,
      timeout: 600_000,
    });
  } catch {
    /* best-effort */
  }

  if (failed.length) emit({ message: `Some node packs need a retry: ${failed.join(", ")}` });
}
