import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { comfy } from "./comfy.ts";
import { logs } from "./logs.ts";
import { writeExtraModelPaths } from "./comfy-env.ts";
import { perfArgs, perfEnv } from "./comfy-perf.ts";

const execFileP = promisify(execFile);

/**
 * Owns the ComfyUI process so its console window stays hidden and its output is
 * captured into the in-app log console. On startup we bring ComfyUI up (if it
 * isn't already reachable) with a hidden window + piped stdio; on shutdown we
 * stop it. Prefers a Latent-managed portable, else the Stability Matrix venv.
 */

let child: ChildProcess | null = null;
/** True when *we* spawned ComfyUI (vs. it was already running elsewhere). */
let owned = false;
/** True once start() has finished deciding what to do (spawn / defer / give up). */
let decided = false;

function managedPaths() {
  const portableDir = join(config.dataDir, "comfyui", "ComfyUI_windows_portable");
  return {
    portableDir,
    python: join(portableDir, "python_embeded", "python.exe"),
    mainRel: join("ComfyUI", "main.py"),
  };
}

/** Read ComfyUI LaunchArgs from Stability Matrix settings.json (best effort). */
function smLaunchArgs(): string[] {
  try {
    const s = JSON.parse(readFileSync(join(config.smDir, "settings.json"), "utf8")) as {
      InstalledPackages?: { PackageName?: string; DisplayName?: string; LaunchArgs?: unknown[] }[];
    };
    const pkg = (s.InstalledPackages ?? []).find(
      (p) => (p.PackageName ?? "").toLowerCase() === "comfyui" || p.DisplayName === "ComfyUI",
    );
    const args: string[] = [];
    for (const a of (pkg?.LaunchArgs ?? []) as { Name?: string; Type?: string; OptionValue?: unknown }[]) {
      const tokens = String(a.Name ?? "").split(/\s+/).filter(Boolean);
      if (a.Type === "Bool") {
        if (a.OptionValue === true) args.push(...tokens);
      } else if (a.OptionValue !== undefined && a.OptionValue !== "" && a.OptionValue !== false) {
        args.push(...tokens, String(a.OptionValue));
      }
    }
    if (args.length) return args;
  } catch {
    /* fall through to defaults */
  }
  return ["--reserve-vram", "0.9", "--preview-method", "auto", "--use-pytorch-cross-attention", "--enable-manager", ...perfArgs()];
}

/** Resolve which ComfyUI to launch: managed portable first, then SM venv. */
function resolveLaunch(): { exe: string; args: string[]; cwd: string } | null {
  const m = managedPaths();
  if (existsSync(m.python) && existsSync(join(m.portableDir, m.mainRel))) {
    // Parity with the Stability-Matrix launch args (all verified against this
    // portable's cli_args): --disable-auto-launch (Latent drives the API, no web
    // UI popup); --preview-method auto (stream live sampling previews — the
    // portable sends none otherwise); --reserve-vram 0.9 (headroom so tight-VRAM
    // cards don't OOM mid-sample); --use-pytorch-cross-attention (stable attention
    // backend / reproducibility); --enable-manager (turn on the ComfyUI-Manager
    // the bootstrap installs).
    return {
      exe: m.python,
      args: [
        "-s",
        m.mainRel,
        "--windows-standalone-build",
        "--disable-auto-launch",
        "--preview-method",
        "auto",
        "--reserve-vram",
        "0.9",
        "--use-pytorch-cross-attention",
        "--enable-manager",
        ...perfArgs(),
      ],
      cwd: m.portableDir,
    };
  }
  // Optional external ComfyUI (Stability Matrix venv) — only if explicitly configured.
  const smPython = config.comfyDir ? join(config.comfyDir, "venv", "Scripts", "python.exe") : "";
  if (smPython && existsSync(smPython)) {
    return {
      exe: smPython,
      args: ["-s", "main.py", "--disable-auto-launch", ...smLaunchArgs()],
      cwd: config.comfyDir,
    };
  }
  return null;
}

function pipe(cp: ChildProcess): void {
  cp.stdout?.on("data", (b: Buffer) => logs.push("comfy", b.toString()));
  cp.stderr?.on("data", (b: Buffer) => logs.push("comfy", b.toString()));
}

/**
 * PIDs of managed-ComfyUI processes running from our portable dir. When the backend
 * restarts, a ComfyUI it spawned keeps running but its captured stderr pipe (owned by
 * the dead backend) goes dead — every subsequent write throws OSError [Errno 22] and
 * crashes generations. We match by the portable path in the command line so we never
 * touch an unrelated / external (Stability Matrix) ComfyUI. Best-effort, Windows-first.
 */
async function findManagedComfyPids(): Promise<number[]> {
  const portableDir = managedPaths().portableDir;
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileP(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
        ],
        { timeout: 8000, windowsHide: true },
      );
      const raw = stdout.trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { ProcessId?: number; CommandLine?: string } | { ProcessId?: number; CommandLine?: string }[];
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .filter((r) => typeof r?.CommandLine === "string" && r.CommandLine.includes(portableDir))
        .map((r) => Number(r.ProcessId))
        .filter((n) => Number.isInteger(n) && n > 0);
    }
    const { stdout } = await execFileP("pgrep", ["-f", portableDir], { timeout: 8000 });
    return stdout.split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return []; // no matches / query unavailable — treat as none
  }
}

/** Kill any orphaned managed ComfyUI and wait for the port to free. Returns true if it
 *  found and cleaned one up (so the caller should launch a fresh, owned instance). */
async function killManagedOrphans(): Promise<boolean> {
  const pids = await findManagedComfyPids();
  if (!pids.length) return false;
  logs.push("comfy", `[latent] Cleaning up an orphaned ComfyUI (PID ${pids.join(", ")}) left by a previous session — its captured output is dead, which would crash generations.`);
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; i < 40; i++) {
    if (!(await comfy.ping())) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  comfy.invalidateObjectInfo();
  return true;
}

export const comfySupervisor = {
  /** Whether Latent is managing (and can stop) the ComfyUI process. */
  isOwned(): boolean {
    return owned && child != null && child.exitCode == null;
  },

  /**
   * True while we expect ComfyUI to come up: before start() has decided anything,
   * or once we've launched our own copy and it's still booting. False once we've
   * decided there's nothing to launch (→ show the first-run setup prompt instead).
   */
  isStarting(): boolean {
    return !decided || this.isOwned();
  },

  /**
   * Ensure ComfyUI is running with a hidden, captured process. If something is
   * already reachable (e.g. the user started it in Stability Matrix), we leave it
   * alone — its logs just won't be captured.
   */
  async start(): Promise<void> {
    if (this.isOwned()) return; // already running our own healthy instance — don't touch it
    try {
      if (await comfy.ping()) {
        // Reachable but unowned: either an external ComfyUI (leave it be) or an orphan
        // from a previous backend whose captured pipe is dead (kill it → launch fresh).
        if (!(await killManagedOrphans())) {
          logs.push("comfy", "[latent] ComfyUI already running externally — using the existing instance (logs not captured).");
          return;
        }
      }
      const launch = resolveLaunch();
      if (!launch) {
        logs.push("comfy", "[latent] No ComfyUI found (managed portable or Stability Matrix venv). Start it manually.");
        return;
      }
      // Keep the managed ComfyUI's model paths in sync with our models root (no-op
      // when the managed portable isn't installed — the SM engine keeps its own yaml).
      writeExtraModelPaths();
      logs.push("comfy", `[latent] Starting ComfyUI: ${launch.exe} ${launch.args.join(" ")}`);
      const cp = spawn(launch.exe, launch.args, {
        cwd: launch.cwd,
        windowsHide: true, // no console window
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...perfEnv() },
      });
      child = cp;
      owned = true;
      pipe(cp);
      cp.on("exit", (code) => {
        logs.push("comfy", `[latent] ComfyUI exited (code ${code ?? "?"}).`);
        if (child === cp) {
          child = null;
          owned = false;
        }
      });
      cp.on("error", (err) => logs.push("comfy", `[latent] ComfyUI failed to start: ${err.message}`));
    } finally {
      decided = true;
    }
  },

  /** Stop the ComfyUI process we own (no-op if we don't own one). */
  stop(): void {
    if (child && child.exitCode == null) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
    child = null;
    owned = false;
  },

  /** Restart the managed ComfyUI so it re-reads extra_model_paths.yaml (e.g. after a
   *  custom model folder is added/removed). No-op source instance is left alone. */
  async restart(): Promise<void> {
    this.stop(); // kill the instance we own (if any)
    // Also clear an orphaned/unowned managed instance — stop() only kills what we own,
    // so without this the Restart button can't recover from an orphan.
    await killManagedOrphans();
    // start() no-ops while ComfyUI still answers, so wait for the port to free first.
    for (let i = 0; i < 40; i++) {
      if (!(await comfy.ping())) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // The restarted ComfyUI may expose a different node set (e.g. a just-installed
    // custom node), so drop the cached catalog — the next read refetches it fresh.
    comfy.invalidateObjectInfo();
    await this.start();
  },
};
