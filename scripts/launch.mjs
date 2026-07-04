// Latent launcher — one action to bring the whole studio up.
//   node scripts/launch.mjs          → prod: install deps (first run), build, serve on :4000
//   node scripts/launch.mjs --dev    → dev: hot-reload on :5173
// On first launch it runs `npm install` itself (so a fresh clone just needs a
// double-click), then builds + starts. ComfyUI is managed by the app on first run.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEV = process.argv.includes("--dev");
// npm writes node_modules/.package-lock.json when an install completes — its
// absence means this is a fresh clone that still needs `npm install`.
const NEEDS_INSTALL = !existsSync(resolve(ROOT, "node_modules", ".package-lock.json"));

// ── tiny .env reader (the launcher runs before any framework loads) ───────────
function loadEnv() {
  const env = {};
  const p = resolve(ROOT, ".env");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m && !line.trimStart().startsWith("#")) env[m[1]] = m[2].trim();
    }
  }
  return env;
}
const env = loadEnv();
const COMFY_URL = env.COMFYUI_URL || "http://127.0.0.1:8188";
// OPTIONAL external ComfyUI (Stability Matrix). Empty by default — Latent manages its
// own portable ComfyUI (auto-downloaded on first run from the in-app setup).
const SM_DIR = env.STABILITY_MATRIX_DIR || "";
const COMFY_DIR = env.COMFYUI_DIR || (SM_DIR ? `${SM_DIR}\\Packages\\ComfyUI` : "");
const PORT = env.PORT || "4000";

// ── launch status server (so the hidden-launch splash shows real progress) ──────
// Serves the current phase on PORT+1; the splash polls it. Because it dies with the
// launcher, the splash can also detect a crash (status unreachable = something failed).
const STATUS_PORT = Number(PORT) + 1;
const INSTALL_PHASE = NEEDS_INSTALL ? ["installing"] : [];
const PHASES = DEV
  ? [...INSTALL_PHASE, "starting", "servers", "waiting-ui", "ready"]
  : [...INSTALL_PHASE, "starting", "building", "starting-server", "waiting-comfy", "ready"];
const SPLASH_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "splash.html");
const status = { phase: "starting", message: "Starting Latent…", steps: PHASES, startedAt: Date.now() };
function setPhase(phase, message) {
  status.phase = phase;
  if (message) status.message = message;
}
// The status server ALSO serves the splash page (over http) so the splash can read
// /status same-origin — file:// pages are blocked from reading cross-origin fetches.
function startStatusServer() {
  createServer((req, res) => {
    if ((req.url || "").startsWith("/status")) {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ ...status, elapsed: Date.now() - status.startedAt }));
      return;
    }
    try {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(SPLASH_PATH, "utf8"));
    } catch {
      res.writeHead(500);
      res.end("splash unavailable");
    }
  })
    .listen(STATUS_PORT, "127.0.0.1")
    .on("error", () => {}); // a stale one may hold the port
}

// ── helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`\x1b[38;5;215m◆\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[38;5;215m!\x1b[0m \x1b[33m${m}\x1b[0m`);

async function isUp(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`   ${label}`);
  while (Date.now() < deadline) {
    if (await isUp(url)) {
      console.log(" ready.");
      return true;
    }
    process.stdout.write(".");
    await sleep(2000);
  }
  console.log("");
  return false;
}

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn(`start "" "${url}"`, { shell: true, detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

// Open the branded loading page immediately; it polls the app and redirects when
// ready — so a hidden console still gives clear "starting…" feedback.
function openSplash(targetUrl) {
  // Served over http by the status server so it can read /status same-origin.
  openBrowser(`http://127.0.0.1:${STATUS_PORT}/?target=${encodeURIComponent(targetUrl)}`);
}

function lanUrls() {
  const urls = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) urls.push(`http://${i.address}:${PORT}`);
    }
  }
  return urls;
}

// First-launch dependency install, so a fresh clone only needs a double-click.
// The launcher itself uses only Node built-ins, so it can run before deps exist.
// Script approvals ship in package.json's `allowScripts`, so native modules
// (better-sqlite3/esbuild/sharp) build without any manual approve-scripts step.
async function ensureDeps() {
  if (!NEEDS_INSTALL) return;
  setPhase("installing", "Installing dependencies… (first launch only — a few minutes)");
  log("First launch — installing dependencies (one time, please wait)…");
  await run("npm install");
  log("Dependencies installed.");
}

// Run a command to completion, streaming its output.
// windowsHide keeps child cmd/console windows from popping when we're launched hidden.
function run(cmd) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, { cwd: ROOT, shell: true, stdio: "inherit", windowsHide: true });
    c.on("exit", (code) => (code === 0 ? res() : rej(new Error(`"${cmd}" exited ${code}`))));
  });
}

// Spawn a long-running process the launcher owns (dies with this window).
function spawnApp(cmd, extraEnv = {}) {
  return spawn(cmd, {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
}

// ── ComfyUI auto-start ────────────────────────────────────────────────────────
function comfyArgs() {
  try {
    const s = JSON.parse(readFileSync(`${SM_DIR}\\settings.json`, "utf8"));
    const pkg = (s.InstalledPackages || []).find(
      (p) => (p.PackageName || "").toLowerCase() === "comfyui" || p.DisplayName === "ComfyUI",
    );
    const args = [];
    for (const a of pkg?.LaunchArgs || []) {
      const tokens = String(a.Name || "").split(/\s+/).filter(Boolean);
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
  return [
    "--reserve-vram", "0.9",
    "--preview-method", "auto",
    "--use-pytorch-cross-attention",
    "--enable-manager",
  ];
}

async function ensureComfy() {
  if (await isUp(`${COMFY_URL}/system_stats`)) {
    log("ComfyUI is already running.");
    return;
  }
  if (!COMFY_DIR) {
    log("No external ComfyUI configured — Latent will use its own managed ComfyUI.");
    log("(First run: open the app and finish setup to auto-download ComfyUI.)");
    return;
  }
  const python = `${COMFY_DIR}\\venv\\Scripts\\python.exe`;
  if (!existsSync(python)) {
    warn(`External ComfyUI venv not found at ${python}.`);
    warn("Set COMFYUI_DIR in .env, or let the app manage its own ComfyUI. Continuing…");
    return;
  }
  const args = comfyArgs();
  log("Starting ComfyUI (Stability Matrix)…");
  // Own console window, detached so it outlives this launcher.
  const cmd = `start "ComfyUI (Latent)" /D "${COMFY_DIR}" "${python}" -s main.py ${args.join(" ")}`;
  spawn(cmd, { shell: true, detached: true, stdio: "ignore" }).unref();
  const ok = await waitFor(`${COMFY_URL}/system_stats`, 150000, "waiting for ComfyUI to load");
  if (!ok) warn("ComfyUI didn't come up in time — continuing (the app will show it offline).");
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n\x1b[1m\x1b[38;5;215m  L A T E N T\x1b[0m  ComfyUI Studio" + (DEV ? "  ·  dev\n" : "\n"));

  // Start the status server + splash FIRST, so a hidden launch shows real progress
  // (and a crash makes the status endpoint go dark → splash flags it, never spins forever).
  startStatusServer();
  const appUrl = DEV ? "http://127.0.0.1:5173" : `http://127.0.0.1:${PORT}`;
  openSplash(appUrl);

  await ensureDeps();

  if (await isUp(`${COMFY_URL}/system_stats`)) log("ComfyUI already running.");
  else log("ComfyUI will be started by Latent (view its logs in the in-app Console).");

  if (DEV) {
    setPhase("servers", "Starting dev servers…");
    log("Starting dev servers (hot reload)…");
    spawnApp("npm run dev");
    setPhase("waiting-ui", "Waiting for the UI…");
    const ok = await waitFor("http://127.0.0.1:5173", 60000, "waiting for the UI");
    if (ok) {
      setPhase("ready", "Ready");
      log("Latent (dev) → http://localhost:5173");
    }
  } else {
    setPhase("building", "Building the UI… (first launch is slower)");
    log("Building the UI…");
    await run("npm run build");
    setPhase("starting-server", "Starting the server…");
    log("Starting Latent…");
    // Real launch: stop the whole studio when the last browser tab closes.
    spawnApp("npm run start", { AUTO_SHUTDOWN: "1" });
    setPhase("waiting-comfy", "Starting ComfyUI…");
    const ok = await waitFor(`http://127.0.0.1:${PORT}/api/health`, 60000, "waiting for the server");
    if (ok) {
      setPhase("ready", "Ready");
      log(`Latent → http://localhost:${PORT}`);
      for (const u of lanUrls()) log(`phone / LAN → ${u}`);
    }
  }
  console.log(
    "\n\x1b[2m  Stop Latent from inside the app (Console → Quit), by closing the last browser tab,\n" +
      "  or with Stop Latent.cmd. ComfyUI stops together with Latent.\x1b[0m\n",
  );
}

main().catch((e) => {
  const msg = e.message || String(e);
  console.error(`\x1b[31m${msg}\x1b[0m`);
  // Report the failure to the splash, then keep the status server alive briefly so
  // the user sees it (instead of an eternal spinner) before we free the port.
  setPhase("error", `Startup failed: ${msg}`);
  setTimeout(() => process.exit(1), 120000);
});
