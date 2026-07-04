# Launching & stopping Latent

## Start (pick one — all run hidden, no console window)

| File | What it does |
|------|--------------|
| **`Latent.vbs`** | **Normal launch.** Builds the UI and runs everything on **http://localhost:4000**, fully hidden. This is the one to use day-to-day (or the desktop shortcut, which points here). |
| **`Latent (Dev).vbs`** | Developer launch — hot-reload dev servers (UI on :5173). For working on the code, not daily use. |
| `Launch Latent.cmd` | Same as `Latent.vbs`, but as a double-clickable `.cmd`. Flashes for a split second, then runs hidden. |
| `Launch Latent (Dev).cmd` | Same as `Latent (Dev).vbs`, `.cmd` form. |

On launch you'll see a **loading splash** → a **"Starting ComfyUI…"** screen while ComfyUI boots → the app once it's ready. All backend + ComfyUI logs are viewable in-app: **sidebar → Console**.

## Stop (any of these)
- **In-app:** sidebar → **Console → Quit Latent** (or Settings → Shut down).
- **Close the last browser tab** — after a ~12s grace, Latent + ComfyUI shut down automatically. (Refreshing or closing/reopening within 12s won't stop it.)
- **`Stop Latent.cmd`** — stops everything from outside the app.

## Desktop shortcut
Run **`Create Desktop Shortcut.cmd`** once to put a "Latent" icon on your Desktop (it targets `Latent.vbs` → fully windowless).

## Troubleshooting a launch that never opens
Run `node scripts\launch.mjs` in a terminal to watch the raw startup logs.

---
Models live at **`C:\Latent\Models`** (moved out of Stability Matrix). The app's data
(DB + generated outputs) is in **`data/`**. Source workflow files are in **`workflows/`**.
