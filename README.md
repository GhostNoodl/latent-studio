# Latent — a ComfyUI Studio

A polished, single-user frontend for ComfyUI. One clean surface for everyday generation, with
full power-user access to every parameter, a persistent searchable gallery, batch/queue, a live
ControlNet panel, an inpaint editor, and phone/LAN access. **Latent downloads and manages its own
ComfyUI on first run** — you don't need an existing install.

## How it works

```
Phone / Laptop / this PC ──▶  Thin backend (:4000)  ──▶  ComfyUI (:8188)
   (one LAN URL)                 ├─ serves the React UI          (auto-provisioned:
                                 ├─ proxies /prompt /view …       portable + custom nodes)
                                 ├─ bridges the ComfyUI WebSocket → browsers
                                 └─ SQLite gallery + saved outputs (./data)
```

Workflows are stored as ComfyUI **API-format** JSON plus an auto-derived param manifest (built from
`/object_info`). New pipelines are data, not code.

## Prerequisites

- **Windows** with an NVIDIA GPU (AMD/Intel/CPU also detected, but NVIDIA is the tested path)
- **Node.js 20+** and **git** on your PATH (git is used to install ComfyUI custom nodes)
- Disk space for ComfyUI (~5 GB) + whatever models you download
- A free **Civitai API key** (for downloading gated/NSFW checkpoints — set it in the first-run wizard)

## Setup & launch

Clone the repo, then **double-click `Latent.vbs`** (or `Launch Latent.cmd`). That's it — the launcher
**installs dependencies on first run** (one time, a few minutes), builds the UI, starts the server on
`:4000`, and opens your browser. No manual `npm install` and no `.env` needed (the defaults work).

**On first run**, finish the in-app setup wizard — it:
1. Downloads + provisions ComfyUI (the official portable + the custom nodes Latent's pipelines need).
2. Walks you through downloading starter models (checkpoints, VAE, ControlNet, upscaler, WAN, …).

Stop it from **Console → Quit** in the app, by closing the last tab, or with `Stop Latent.cmd`.

### If it won't start
The launcher runs hidden, so failures are quiet. It self-checks the essentials:
- **No Node.js** → `Latent.vbs` shows a message with the download link. Install **Node.js 20+** from
  [nodejs.org](https://nodejs.org) and relaunch. (This is the most common "nothing happens" cause.)
- Anything else → check **`launch.log`** in the app folder, or run `node scripts/launch.mjs` in a
  terminal to see the error live. `git` (for ComfyUI's custom nodes) is also required — get it from
  [git-scm.com](https://git-scm.com/download/win).

- **`Latent (Dev).vbs`** / **`Launch Latent (Dev).cmd`** — hot-reload dev mode on `:5173`.
- **`Create Desktop Shortcut.cmd`** — a one-click **Latent** desktop shortcut (with icon).
- Equivalents: `npm run launch` / `npm run launch:dev`.

Everything the app writes (SQLite DB, outputs, the managed ComfyUI, downloaded models) lives under
`./data` (gitignored). Phone/other devices open `http://<this-PC-LAN-IP>:4000`.

### Install as an app (PWA)
Installable. On **desktop** (Chrome/Edge at `http://localhost:4000`), click the **Install** icon in
the address bar. On **phone**, open the LAN URL → **Add to Home Screen**.
> Full offline PWA needs HTTPS; over plain `http` LAN you still get the icon/name via Add to Home Screen.

### Configuration
All settings have sensible defaults — see `.env.example`. Notable optional overrides:
`SM_MODELS_DIR` (point at an existing model library), `ACCESS_TOKEN` (require a token for LAN
exposure), `CIVITAI_API_KEY`, and `STABILITY_MATRIX_DIR`/`COMFYUI_DIR` (drive an *existing* ComfyUI
instead of the managed one).

## Pipelines
Grouped as **base → mode** sub-tabs:
- **Illustrious** — `txt2img` · `img2img` · `inpaint`, each with a toggleable **ControlNet** panel
  (preprocessor selector + live control-map preview), LoRA loader, Hires Fix, and a mask editor with
  soft brush + yolo auto-masking.
- **WAN 2.2** — image-to-video (first/last frame + frame interpolation).

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

See `CREDITS.md` for third-party attribution and `LAUNCHERS.md` for launcher details.
