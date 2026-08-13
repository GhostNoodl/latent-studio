import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { rename, stat, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { config } from "./config.ts";
import { comfy } from "./comfy.ts";
import { bridge } from "./ws-bridge.ts";
import { logs } from "./logs.ts";
import { KIND_FOLDERS } from "./models-catalog.ts";
import { getCustomModelPaths } from "./model-paths.ts";
import { perfArgs, perfEnv } from "./comfy-perf.ts";
import { MANAGED_RUNTIME, type RuntimeNode } from "./runtime-manifest.ts";
import type { GpuInfo, ModelKind, SetupStatus } from "@latent/shared";

/**
 * First-run ComfyUI provisioning: detect the GPU, install a Latent-managed
 * ComfyUI under the data dir, launch it, and install the custom nodes the
 * bundled pipelines need. Lets someone run Latent with no ComfyUI installed.
 * Windows uses the official portable (embedded Python + torch); Linux builds
 * the same layout from the release's source snapshot + a python3 venv.
 */

const require = createRequire(import.meta.url);
const { path7za } = require("7zip-bin") as { path7za: string };
const exec = promisify(execFile);

const EXTRA_PIP = [...MANAGED_RUNTIME.extraPip];

// ── Managed install paths (a Latent-owned ComfyUI under the data dir) ────────
// Windows: the official portable (python_embeded + ComfyUI). Linux: a source
// snapshot + a python3 venv — same ComfyUI/ subdir, so downstream code is shared.
const isWin = process.platform === "win32";
const installRoot = join(config.dataDir, "comfyui");
const portableDir = join(installRoot, isWin ? "ComfyUI_windows_portable" : "ComfyUI_linux");
const embeddedPython = isWin
  ? join(portableDir, "python_embeded", "python.exe")
  : join(portableDir, "venv", "bin", "python");
const mainPy = join(portableDir, "ComfyUI", "main.py");
const comfyCwd = join(portableDir, "ComfyUI");

function isInstalled(): boolean {
  if (!existsSync(mainPy)) return false;
  if (isWin) return existsSync(embeddedPython);
  // A half-created venv doesn't count: Ubuntu's ensurepip-less python3 creates
  // bin/python and then fails, so only call it installed once pip is in place.
  return existsSync(embeddedPython) && existsSync(join(portableDir, "venv", "bin", "pip"));
}

// ── Share existing model folders with the managed ComfyUI ─────────────────────
// Maps our kinds → ComfyUI's model-type keys; folders come from KIND_FOLDERS.
const COMFY_KEY: Record<ModelKind, string> = {
  checkpoint: "checkpoints",
  diffusion: "diffusion_models",
  text_encoder: "text_encoders",
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
  // Aliases and model types beyond our catalog kinds. Missing folders are ignored.
  entry("clip", ["TextEncoders"]);
  entry("clip_vision", ["ClipVision"]);
  entry("ipadapter", ["IpAdapter", "IpAdapters15", "IpAdaptersXl"]);
  entry("gligen", ["GLIGEN"]);
  entry("vae_approx", ["ApproxVAE"]);
  entry("hypernetworks", ["Hypernetwork"]);
  entry("style_models", ["StyleModels", "style_models"]);
  entry("ultralytics_bbox", ["Ultralytics/bbox"]);
  entry("ultralytics_segm", ["Ultralytics/segm"]);
  entry("ultralytics", ["Ultralytics"]);
  entry("latent_upscale_models", ["LatentUpscaleModels"]); // LTX spatial upscaler
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
  if (!isWin) {
    // Linux: read the VGA/3D devices off lspci (wmic is Windows-only).
    try {
      const { stdout } = await exec("lspci", [], { timeout: 6000 });
      const vga = stdout
        .split("\n")
        .filter((l) => /vga|3d controller/i.test(l))
        .join("\n");
      if (/radeon|\bamd\b/i.test(vga)) return { vendor: "amd", name: firstGpuLine(vga) };
      if (/intel/i.test(vga)) return { vendor: "intel", name: firstGpuLine(vga) };
    } catch {
      /* lspci unavailable */
    }
    return { vendor: "cpu" };
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

interface Release {
  tag: string;
  asset: string;
  url: string;
  sizeBytes: number;
  sha256?: string;
}

async function resolveRelease(vendor: GpuInfo["vendor"]): Promise<Release> {
  if (!isWin) {
    // No official Linux portable — provision from the release's source tarball and
    // build a venv. sizeBytes is an estimate of the total pull (torch + ComfyUI deps
    // + node packs); the source tarball itself is only a few MB.
    return {
      tag: MANAGED_RUNTIME.comfy.tag,
      asset: "source snapshot + python venv",
      url: `https://github.com/Comfy-Org/ComfyUI/archive/${MANAGED_RUNTIME.comfy.commit}.tar.gz`,
      sizeBytes: vendor === "nvidia" ? 3_500_000_000 : 1_200_000_000,
    };
  }
  const key = vendor === "amd" ? "amd" : vendor === "intel" ? "intel" : "nvidia";
  const asset = MANAGED_RUNTIME.comfy.windows[key];
  return {
    tag: MANAGED_RUNTIME.comfy.tag,
    asset: asset.asset,
    url: `https://github.com/Comfy-Org/ComfyUI/releases/download/${MANAGED_RUNTIME.comfy.windowsBaseTag}/${asset.asset}`,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
  };
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
      const archive = join(installRoot, isWin ? rel.asset : `comfyui-${rel.tag}.tar.gz`);
      await downloadTo(
        rel.url,
        archive,
        (received, total) => emit({ received, total }),
        rel.sha256 ? rel.sizeBytes : 0,
        rel.sha256,
      );

      if (isWin) {
        emit({ phase: "extracting", message: "Unpacking ~6 GB…" });
        await extract7z(archive, installRoot);
        rmSync(archive, { force: true });
        if (!isInstalled()) throw new Error("Extracted archive missing the expected ComfyUI layout");
        await pinWindowsComfyCore();
      } else {
        await provisionLinux(archive, rel.tag, gpu);
      }

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
  expectedBytes = 0,
  expectedSha256?: string,
): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  const complete = await stat(dest).catch(() => null);
  if (complete && (!expectedBytes || complete.size === expectedBytes)) {
    try {
      if (expectedSha256) await verifySha256(dest, expectedSha256);
      onProgress(complete.size, expectedBytes || complete.size);
      return;
    } catch {
      rmSync(dest, { force: true });
    }
  }
  if (complete) rmSync(dest, { force: true });

  const part = `${dest}.part`;
  let offset = (await stat(part).catch(() => null))?.size ?? 0;
  if (expectedBytes && offset === expectedBytes) {
    try {
      if (expectedSha256) await verifySha256(part, expectedSha256);
      await rename(part, dest);
      onProgress(offset, expectedBytes);
      return;
    } catch {
      rmSync(part, { force: true });
      offset = 0;
    }
  } else if (expectedBytes && offset > expectedBytes) {
    rmSync(part, { force: true });
    offset = 0;
  }
  const fs = await statfs(dirname(dest));
  const available = Number(fs.bavail) * Number(fs.bsize);
  const remaining = Math.max(0, expectedBytes - offset);
  if (remaining && available < remaining + 256 * 1024 * 1024) {
    throw new Error(`Not enough disk space for the managed runtime (${(remaining / 1_073_741_824).toFixed(1)} GB needed)`);
  }

  const request = (resumeAt: number) => fetch(url, {
    redirect: "follow",
    headers: resumeAt ? { range: `bytes=${resumeAt}-` } : undefined,
    signal: AbortSignal.timeout(30 * 60_000),
  });
  let res = await request(offset);
  if (offset && res.status === 416) {
    // The partial may already be complete but lack a trustworthy size/hash, or
    // the origin may reject its range. Restart instead of getting stuck forever.
    rmSync(part, { force: true });
    offset = 0;
    res = await request(0);
  }
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  if (offset && res.status !== 206) offset = 0;
  const responseBytes = Number(res.headers.get("content-length")) || 0;
  const total = expectedBytes || (responseBytes ? offset + responseBytes : 0);
  let received = offset;
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
  await pipeline(body, createWriteStream(part, { flags: offset ? "a" : "w" }));
  const saved = await stat(part);
  if (expectedBytes && saved.size !== expectedBytes) {
    throw new Error(`Runtime archive size mismatch: expected ${expectedBytes}, received ${saved.size}`);
  }
  if (responseBytes && saved.size !== offset + responseBytes) {
    throw new Error(`Runtime archive download was incomplete (${saved.size}/${offset + responseBytes} bytes)`);
  }
  if (expectedSha256) {
    try {
      await verifySha256(part, expectedSha256);
    } catch (err) {
      rmSync(part, { force: true });
      throw err;
    }
  }
  await rename(part, dest);
  onProgress(saved.size, total || saved.size);
}

async function verifySha256(path: string, expected: string): Promise<void> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  if (hash.digest("hex").toLowerCase() !== expected.toLowerCase()) {
    throw new Error("Managed runtime archive failed SHA-256 verification");
  }
}

function extract7z(archive: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(path7za, ["x", archive, `-o${outDir}`, "-y"], { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`7za exited ${code}`))));
  });
}

/** Official Windows portable archives trail core releases occasionally. Keep
 * the verified Python/Torch bundle, but advance its Git checkout to Latent's
 * tested immutable core commit and install that commit's pinned requirements. */
async function pinWindowsComfyCore(): Promise<void> {
  if (!existsSync(join(comfyCwd, ".git"))) {
    throw new Error("The managed ComfyUI portable is missing its Git checkout");
  }
  emit({ phase: "installing-nodes", message: `Pinning ComfyUI core ${MANAGED_RUNTIME.comfy.tag}…` });
  await exec("git", ["-C", comfyCwd, "diff", "--quiet"], { timeout: 30_000 });
  await exec(
    "git",
    ["-C", comfyCwd, "fetch", "--depth", "1", "origin", MANAGED_RUNTIME.comfy.commit],
    { timeout: 180_000 },
  );
  await exec("git", ["-C", comfyCwd, "checkout", "--detach", MANAGED_RUNTIME.comfy.commit], {
    timeout: 60_000,
  });
  emit({ message: "Installing ComfyUI core dependencies…" });
  await runStreaming(
    embeddedPython,
    ["-m", "pip", "install", "--no-warn-script-location", "-r", join(comfyCwd, "requirements.txt")],
    { cwd: comfyCwd, timeout: 1_800_000 },
  );
}

function launchManaged(gpu: GpuInfo): void {
  const args = [
    "-s",
    join("ComfyUI", "main.py"),
    ...(isWin ? ["--windows-standalone-build"] : []),
    "--disable-auto-launch",
    "--preview-method",
    "auto", // stream live sampling previews to the result canvas
    "--reserve-vram",
    "0.9", // VRAM headroom so tight cards don't OOM mid-sample
    "--use-pytorch-cross-attention",
    "--enable-manager",
  ];
  if (gpu.vendor === "cpu") args.push("--cpu");
  args.push(...perfArgs());
  const child = spawn(embeddedPython, args, {
    cwd: portableDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, ...perfEnv() },
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
  const managerDir = join(comfyCwd, "custom_nodes", "ComfyUI-Manager");

  // 1. Ensure ComfyUI-Manager at the compatibility-set commit.
  emit({ message: "Installing ComfyUI-Manager…" });
  try {
    await installPinnedNode(MANAGED_RUNTIME.manager, managerDir);
  } catch {
    emit({ message: "Couldn't install ComfyUI-Manager (is git installed?) — add nodes manually." });
    return;
  }

  // 2. Install every pipeline node pack at an immutable commit.
  const failed: string[] = [];
  for (const node of MANAGED_RUNTIME.nodes) {
    emit({ message: `Installing node: ${node.dir}…` });
    try {
      await installPinnedNode(node, join(comfyCwd, "custom_nodes", node.dir));
    } catch {
      failed.push(node.dir);
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

async function installPinnedNode(node: RuntimeNode, target: string): Promise<void> {
  if (!existsSync(target)) {
    await exec("git", ["clone", "--filter=blob:none", "--no-checkout", node.url, target], {
      timeout: 180_000,
    });
  }
  if (!existsSync(join(target, ".git"))) {
    throw new Error(`${node.dir} exists but is not a Git checkout`);
  }
  await exec("git", ["-C", target, "diff", "--quiet"], { timeout: 30_000 });
  await exec("git", ["-C", target, "fetch", "--depth", "1", "origin", node.commit], {
    timeout: 180_000,
  });
  await exec("git", ["-C", target, "checkout", "--detach", node.commit], { timeout: 60_000 });
  await exec("git", ["-C", target, "submodule", "update", "--init", "--recursive", "--depth", "1"], {
    timeout: 180_000,
  });
  const requirements = join(target, "requirements.txt");
  if (existsSync(requirements)) {
    await exec(
      embeddedPython,
      ["-m", "pip", "install", "--no-warn-script-location", "-r", requirements],
      { cwd: comfyCwd, timeout: 600_000 },
    );
  }
}

/**
 * Linux provisioning: there's no official portable, so unpack the release's
 * source snapshot and build a python3 venv (torch from pip, index per GPU
 * vendor). The layout mirrors the Windows portable (portableDir/ComfyUI +
 * portableDir/venv), so the launcher and node installer stay platform-agnostic.
 */
async function provisionLinux(archive: string, tag: string, gpu: GpuInfo): Promise<void> {
  emit({ phase: "extracting", message: "Unpacking the ComfyUI source…" });
  mkdirSync(comfyCwd, { recursive: true });
  await exec("tar", ["-xzf", archive, "-C", comfyCwd, "--strip-components=1"], { timeout: 120_000 });
  rmSync(archive, { force: true });
  if (!existsSync(mainPy)) throw new Error(`Source snapshot for ${tag} is missing ComfyUI/main.py`);

  try {
    await exec("python3", ["--version"], { timeout: 10_000 });
  } catch {
    throw new Error("python3 was not found on PATH — install it (e.g. sudo apt install python3 python3-venv) and retry.");
  }
  emit({ phase: "installing-nodes", message: "Creating the Python environment (venv)…" });
  try {
    await runStreaming("python3", ["-m", "venv", join(portableDir, "venv")], { timeout: 180_000 });
  } catch {
    // Debian/Ubuntu's stock python3 lacks ensurepip (python3-venv not installed).
    // Rather than demanding a sudo install, build a pip-less venv and bootstrap
    // pip into it with get-pip.py.
    try {
      emit({ message: "python3-venv is missing — bootstrapping pip manually…" });
      rmSync(join(portableDir, "venv"), { recursive: true, force: true });
      await runStreaming("python3", ["-m", "venv", "--without-pip", join(portableDir, "venv")], { timeout: 180_000 });
      const getPip = join(installRoot, "get-pip.py");
      await downloadTo("https://bootstrap.pypa.io/get-pip.py", getPip, () => {});
      await runStreaming(embeddedPython, [getPip], { cwd: comfyCwd, timeout: 300_000 });
      rmSync(getPip, { force: true });
    } catch {
      throw new Error("Couldn't create a Python venv — on Debian/Ubuntu fix with: sudo apt install python3-venv");
    }
  }

  // Torch first (index per vendor), then ComfyUI's own requirements. NVIDIA uses
  // the default PyPI wheels (CUDA-bundled on Linux); AMD/CPU use PyTorch's index.
  const torchIndex =
    gpu.vendor === "amd"
      ? ["--index-url", "https://download.pytorch.org/whl/rocm6.3"]
      : gpu.vendor === "nvidia"
        ? []
        : ["--index-url", "https://download.pytorch.org/whl/cpu"];
  emit({
    phase: "installing-nodes",
    message: "Installing PyTorch + ComfyUI dependencies (a few GB — live output in the Console)…",
  });
  await runStreaming(embeddedPython, ["-m", "pip", "install", ...torchIndex, "torch", "torchvision", "torchaudio"], {
    cwd: comfyCwd,
    timeout: 1_800_000,
  });
  await runStreaming(embeddedPython, ["-m", "pip", "install", "-r", join(comfyCwd, "requirements.txt")], {
    cwd: comfyCwd,
    timeout: 1_800_000,
  });

  if (!isInstalled()) throw new Error("Provisioning finished but the expected ComfyUI layout is incomplete");
}

/** Run a long command, streaming its output into the in-app Console. */
function runStreaming(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number },
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise();
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      p.kill();
      rejectOnce(new Error(`"${cmd}" timed out`));
    }, opts.timeout);
    p.stdout?.on("data", (b: Buffer) => logs.push("comfy", b.toString()));
    p.stderr?.on("data", (b: Buffer) => logs.push("comfy", b.toString()));
    p.on("error", rejectOnce);
    p.on("close", (code) => {
      if (code === 0) resolveOnce();
      else rejectOnce(new Error(`"${cmd} ${args.join(" ")}" exited ${code}`));
    });
  });
}
