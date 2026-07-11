# Launching & stopping Latent

## Start (pick one — each opens one console window you can watch)

| File | What it does |
|------|--------------|
| **`Latent.vbs`** | **Normal launch.** Builds the UI and runs everything on **http://localhost:4000**. Opens a **"Latent" console window** that stays open with all logs. This is the one to use day-to-day (or the desktop shortcut, which points here). |
| **`Latent (Dev).vbs`** | Developer launch — hot-reload dev servers (UI on :5173). For working on the code, not daily use. |
| `Launch Latent.cmd` | Same as `Latent.vbs`, but as a double-clickable `.cmd`. This launcher window flashes for a split second, then the persistent Latent console opens. |
| `Launch Latent (Dev).cmd` | Same as `Latent (Dev).vbs`, `.cmd` form. |

On launch you'll see a **loading splash** → a **"Starting ComfyUI…"** screen while ComfyUI boots → the app once it's ready. A **console window** also stays open the whole time showing startup + backend + ComfyUI logs (close it or press **Ctrl+C** to stop everything). The same logs are viewable in-app: **sidebar → Console**.

## Stop (any of these)
- **In-app:** sidebar → **Console → Quit Latent** (or Settings → Shut down).
- **Close the last browser tab** — after a ~12s grace, Latent + ComfyUI shut down automatically. (Refreshing or closing/reopening within 12s won't stop it.)
- **Close the console window** (or press **Ctrl+C** in it) — kills the launcher and everything it started.
- **`Stop Latent.cmd`** — stops everything from outside the app.

## Desktop shortcut
Run **`Create Desktop Shortcut.cmd`** once to put a "Latent" icon on your Desktop (it targets `Latent.vbs`, which opens the Latent console window).

## Troubleshooting a launch that never opens
Run `node scripts\launch.mjs` in a terminal to watch the raw startup logs.

---
Models live at **`C:\Latent\Models`** (moved out of Stability Matrix). The app's data
(DB + generated outputs) is in **`data/`**. Source workflow files are in **`workflows/`**.
