# Latent — a ComfyUI Studio

A polished, single-user frontend for ComfyUI image, video, and music generation. One clean surface for everyday generation, with
full power-user access to every parameter, a persistent searchable gallery, batch/queue, a live
ControlNet panel, an inpaint editor, and private phone access. **Latent downloads and manages its own
ComfyUI on first run** — you don't need an existing install.

## How it works

```
Phone / Laptop / this PC ──▶  Thin backend (:4000)  ──▶  ComfyUI (:8188)
 (Tailscale HTTPS / local)       ├─ serves the React UI          (auto-provisioned:
                                 ├─ proxies /prompt /view …       portable + custom nodes)
                                 ├─ bridges the ComfyUI WebSocket → browsers
                                 └─ SQLite gallery + saved outputs (./data)
```

Workflows are stored as ComfyUI **API-format** JSON plus an auto-derived param manifest (built from
`/object_info`). New pipelines are data, not code.

## Prerequisites

- **Windows or Linux** with an NVIDIA GPU (AMD/Intel/CPU also detected, but NVIDIA is the tested path)
- **Node.js 22.13+** — **22 or 24 LTS recommended** (the newest "Current" release can lack
  prebuilt native binaries, which forces a from-source compile). Get it from
  [nodejs.org](https://nodejs.org), or let `Latent.vbs` install the LTS for you via winget.
  **git** also needs to be on your PATH (it's used to install ComfyUI custom nodes)
- **Linux only:** `python3` + `python3-venv` on your PATH — the managed ComfyUI is provisioned
  from the release source into a venv (the Windows build uses the official portable instead)
- Disk space for ComfyUI (~5 GB) + whatever models you download (the recommended MiniMax Music 3 pack is ~11.1 GB)
- A free **Civitai API key** (for downloading gated/NSFW checkpoints — set it in the first-run wizard)

## Setup & launch

Clone the repo, then **double-click `Latent.vbs`** (or `Launch Latent.cmd`) — on **Linux**, run
`npm run launch` instead. That's it — the launcher **installs dependencies on first run** (one time,
a few minutes), builds the UI, starts the server on `:4000`, and opens your browser. No manual
`npm install` and no `.env` needed (the defaults work).

**On first run**, finish the in-app setup wizard — it:
1. Downloads + provisions ComfyUI (the official portable + the custom nodes Latent's pipelines need).
2. Walks you through downloading starter models (checkpoints, VAE, ControlNet, upscaler, LTX 2.3, MiniMax Music 3, …).

A **console window** stays open the whole time with the launcher, backend, and ComfyUI logs. Stop it
from **Console → Quit** in the app, by closing that console window (or **Ctrl+C** in it), or with
`Stop Latent.cmd`. Closing the last browser tab also stops LAN-only launches; it deliberately does
not stop a Tailscale-enabled launch when a phone goes to sleep.

### If it won't start
Watch the console window for the error (it stays open on a crash), or check **`launch.log`** in the
app folder. It also self-checks the essentials:
- **No Node.js** → `Latent.vbs` offers a one-click install of Node.js LTS via winget (or shows a
  message with the download link). Relaunch when it's installed. (This is the most common
  "nothing happens" cause — if PATH hasn't refreshed yet, restart the PC once.)
- **First-run `npm install` fails** → the launcher prints the likely cause and fix in the console
  + `launch.log`. The usual three:
  - *native module compiled from source* (`gyp ERR!`, `No prebuilt binaries found`) → use
    **Node 22 or 24 LTS** (prebuilt binaries exist for those; no compiler needed), or install
    Visual Studio Build Tools (Desktop C++) + Python.
  - *locked files* (`EPERM`/`EBUSY`) → OneDrive-synced folder, antivirus, or a still-running
    Latent — move to a plain path like `C:\Latent` and relaunch.
  - *network* (`ETIMEDOUT`/`403`/cert errors) → proxy/VPN/antivirus blocking npm or GitHub.
- Anything else → check **`launch.log`** in the app folder, or run `node scripts/launch.mjs` in a
  terminal to see the error live. `git` (for ComfyUI's custom nodes) is also required — get it from
  [git-scm.com](https://git-scm.com/download/win).

- **`Latent (Dev).vbs`** / **`Launch Latent (Dev).cmd`** — hot-reload dev mode on `:5173`.
- **`Create Desktop Shortcut.cmd`** — a one-click **Latent** desktop shortcut (with icon).
- Equivalents: `npm run launch` / `npm run launch:dev`.

Everything the app writes (SQLite DB, outputs, the managed ComfyUI, downloaded models) lives under
`./data` (gitignored).

### Phone access — no pairing token

Install and sign in to [Tailscale](https://tailscale.com/download) on the PC and phone. From then on,
the normal Latent launcher automatically publishes a stable private HTTPS address, verifies your
Tailscale identity, and shows a QR code under **Settings → Connection**. Scan it once and use
**Add to Home Screen**; future use is just **launch Latent on the PC → tap Latent on the phone**.
There is no IP, port, pairing token, or manual `tailscale serve` command to manage.

If Tailscale is absent or offline, Latent safely falls back to the existing LAN flow:
`http://<this-PC-LAN-IP>:4000`, followed by one-time pairing with the token under
**Settings → Connection**. Set `TAILSCALE_MODE=off` in `.env` to choose this explicitly.

### Install as an app (PWA)
Installable. On **desktop** (Chrome/Edge at `http://localhost:4000`), click the **Install** icon in
the address bar. On **phone**, scan the private HTTPS QR under **Settings → Connection**, then choose
**Add to Home Screen**. Plain-HTTP LAN fallback can still add the icon/name, but full PWA behavior
requires the HTTPS Tailscale path.

### Configuration
All settings have sensible defaults — see `.env.example`. Notable optional overrides:
`TAILSCALE_MODE=off` (disable automatic private phone access), `SM_MODELS_DIR` (point at an existing
model library), `ACCESS_TOKEN` (replace the generated LAN
pairing token), `CIVITAI_API_KEY`, and `STABILITY_MATRIX_DIR`/`COMFYUI_DIR` (drive an *existing*
ComfyUI instead of the managed one).

Managed installs use the fixed compatibility set in `backend/src/runtime-manifest.ts`: ComfyUI
portable archives are size- and SHA-256-verified, the core and custom nodes are checked out at
immutable commits, and supplemental Python packages are version-pinned. Before starting its managed
ComfyUI, Latent automatically reconciles its core and Git-managed custom nodes to that tested set;
it never follows an upstream development branch. Older archive-installed node snapshots are
preserved in place. **Settings → Connection → Managed runtime** also shows the installed/target
version and offers **Update now**. Updates wait for an idle queue, preserve models and outputs, and
restore the previous Git revisions if an update fails. An external ComfyUI remains under its own
update mechanism and is never stopped or modified by this flow.

## Pipelines
Grouped as **base → mode** sub-tabs:
- **Image** — `txt2img` · `img2img` · `inpaint`, each with a toggleable **ControlNet** panel
  (preprocessor selector + live control-map preview), LoRA loader, Hires Fix, and a mask editor with
  soft brush + yolo auto-masking.
- **LTX 2.3** — image-to-video with synchronized audio, powered by the Sulphur 2 GGUF finetune
  (native ComfyUI nodes, two-stage distilled sampling).
- **MiniMax H3** — text-to-video and image-to-video with native synchronized-audio generation.
- **MiniMax Music 3** — caption + tagged-lyrics song authoring on NVIDIA/CUDA, up to five minutes, with a
  one-click verified int8 model pack and first-class audio playback in Generate and Gallery.

Import your own ComfyUI **API-format** workflows too — they appear under a **Custom** family.

## Importing a workflow
1. In ComfyUI, **Export (API)** ("Save (API Format)" with Dev mode on) — this flattens routing nodes.
2. The import auto-builds controls from `/object_info` (curated in **Simple**, everything in
   **Advanced**, **Raw** edits the JSON).
> ComfyUI **subgraphs** / some custom save nodes don't serialize to API format (they export with no
> `class_type`) — flatten or replace them before exporting.

## Workspace layout
- `frontend/` — React + Vite + TS, Tailwind v4, TanStack Query, Zustand
- `backend/`  — Fastify (runs via tsx), better-sqlite3, ws bridge to ComfyUI, model/ComfyUI provisioning
- `shared/`   — TypeScript types shared by both
- `workflows/` — bundled default pipelines (API-format JSON)
- `data/`     — runtime state: DB, outputs, managed ComfyUI, models (gitignored)

## Development checks

`npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` form the main validation gate.
`npm run test:e2e` runs the isolated Chromium desktop/mobile smoke suite after a build. CI runs these
checks on Windows and Linux with Node 22 and 24.

See `CREDITS.md` for third-party attribution and `LAUNCHERS.md` for launcher details.
