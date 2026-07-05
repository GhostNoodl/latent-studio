import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive, FolderPlus, FolderSearch, FolderOpen, X, RefreshCw, Loader2, Check, AlertCircle } from "lucide-react";
import type { CustomModelPath, ModelKind } from "@latent/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/primitives";
import { FolderPicker } from "@/components/FolderPicker";
import { cn } from "@/lib/utils";

const KIND_LABELS: [ModelKind | "root", string][] = [
  ["checkpoint", "Checkpoints"],
  ["lora", "LoRAs"],
  ["vae", "VAEs"],
  ["controlnet", "ControlNets"],
  ["upscale", "Upscalers"],
  ["embedding", "Embeddings"],
  ["diffusion", "Diffusion / UNet"],
  ["root", "Full models tree"],
];
const kindLabel = (k: string) => KIND_LABELS.find(([v]) => v === k)?.[1] ?? k;
const inputCls =
  "min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2.5 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)] focus:outline-none";

/** Settings section: add filesystem folders that Latent + ComfyUI also search for models. */
export function ModelDirectories() {
  const queryClient = useQueryClient();
  const { data: paths = [] } = useQuery({ queryKey: ["model-paths"], queryFn: api.modelPaths });
  const [newPath, setNewPath] = useState("");
  const [newKind, setNewKind] = useState<ModelKind | "root">("checkpoint");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // "Scan a home folder" state
  const [scanHome, setScanHome] = useState("");
  const [scanning, setScanning] = useState(false);
  const [picking, setPicking] = useState(false);
  const [scanResults, setScanResults] = useState<
    { path: string; kind: ModelKind; count: number }[] | null
  >(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function save(next: CustomModelPath[]) {
    const res = await api.saveModelPaths(next);
    queryClient.invalidateQueries({ queryKey: ["model-paths"] });
    queryClient.invalidateQueries({ queryKey: ["models"] }); // refresh the model pickers
    if (res.needsRestart) setNeedsRestart(true);
  }

  async function add() {
    const path = newPath.trim();
    if (!path) return;
    setBusy(true);
    setErr(null);
    try {
      const v = await api.validateModelPath(path);
      if (!v.exists) {
        setErr("That folder doesn't exist (or Latent can't read it).");
        return;
      }
      await save([...paths, { id: crypto.randomUUID().slice(0, 8), path, kind: newKind }]);
      setNewPath("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add the folder.");
    } finally {
      setBusy(false);
    }
  }

  async function scan(overrideHome?: string) {
    const home = (overrideHome ?? scanHome).trim();
    if (!home) return;
    setScanning(true);
    setErr(null);
    setScanResults(null);
    try {
      const found = await api.scanModelHome(home);
      const existing = new Set(paths.map((p) => p.path.toLowerCase()));
      const fresh = found.filter((f) => !existing.has(f.path.toLowerCase()));
      setScanResults(fresh);
      setSelected(new Set(fresh.map((f) => f.path)));
      if (found.length === 0) setErr("No model folders found under that path.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function addScanned() {
    const toAdd = (scanResults ?? [])
      .filter((r) => selected.has(r.path))
      .map((r) => ({ id: crypto.randomUUID().slice(0, 8), path: r.path, kind: r.kind }));
    if (!toAdd.length) return;
    await save([...paths, ...toAdd]);
    setScanResults(null);
    setScanHome("");
  }

  function toggle(path: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  }

  async function restart() {
    setRestarting(true);
    try {
      await api.restartComfy();
      setNeedsRestart(false);
    } finally {
      setTimeout(() => setRestarting(false), 4000);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <HardDrive className="h-4 w-4 text-[var(--color-amber)]" /> Model directories
      </div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">
        Extra folders where you keep models. Latent and ComfyUI will also search them — great for a
        checkpoint stash on another drive you don't want to copy into the app.
      </p>

      {/* Current folders */}
      {paths.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {paths.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-ink)] px-2.5 py-1.5"
            >
              <span className="shrink-0 rounded bg-[var(--color-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted)]">
                {kindLabel(p.kind)}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-text)]" title={p.path}>
                {p.path}
              </span>
              <button
                type="button"
                onClick={() => save(paths.filter((x) => x.id !== p.id))}
                title="Remove"
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--color-faint)] transition-colors hover:text-[var(--color-danger)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Scan a home folder → auto-detect model subfolders */}
      <div className="mb-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-ink)]/40 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={scanHome}
            onChange={(e) => setScanHome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && scan()}
            placeholder="Scan a home folder for models (e.g. D:\\AI\\Models)"
            className={cn(inputCls, "flex-1 font-mono")}
          />
          <button
            type="button"
            onClick={() => setPicking(true)}
            title="Browse for a folder"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-amber)] hover:text-[var(--color-amber)]"
          >
            <FolderOpen className="h-3.5 w-3.5" /> Browse
          </button>
          <button
            type="button"
            onClick={() => scan()}
            disabled={scanning || !scanHome.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-elevated)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-amber)] hover:text-[var(--color-on-amber)] disabled:opacity-40"
          >
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderSearch className="h-3.5 w-3.5" />}
            {scanning ? "Scanning…" : "Scan"}
          </button>
        </div>
        {scanResults && scanResults.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[11px] text-[var(--color-muted)]">
              Found {scanResults.length} model folder{scanResults.length === 1 ? "" : "s"} — pick which to add:
            </div>
            {scanResults.map((r) => (
              <label
                key={r.path}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-[var(--color-elevated)]/40"
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.path)}
                  onChange={() => toggle(r.path)}
                  className="accent-[var(--color-amber)]"
                />
                <span className="shrink-0 rounded bg-[var(--color-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted)]">
                  {kindLabel(r.kind)}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text)]" title={r.path}>
                  {r.path}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--color-faint)]">{r.count} files</span>
              </label>
            ))}
            <button
              type="button"
              onClick={addScanned}
              disabled={selected.size === 0}
              className="mt-1 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-3 py-1.5 text-sm font-medium text-[var(--color-on-amber)] disabled:opacity-40"
            >
              <FolderPlus className="h-3.5 w-3.5" /> Add {selected.size} folder{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        )}
        {scanResults && scanResults.length === 0 && (
          <p className="mt-2 text-[11px] text-[var(--color-faint)]">Nothing new found under that folder.</p>
        )}
      </div>

      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
        Or add one manually
      </div>

      {/* Add a folder */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="C:\\path\\to\\your\\models"
          className={cn(inputCls, "flex-1 font-mono")}
        />
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as ModelKind | "root")}
          className={cn(inputCls, "shrink-0")}
        >
          {KIND_LABELS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={busy || !newPath.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-elevated)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-amber)] hover:text-[var(--color-on-amber)] disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
          Add
        </button>
      </div>
      {err && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-danger)]">
          <AlertCircle className="h-3 w-3" /> {err}
        </p>
      )}
      <p className="mt-2 text-[11px] text-[var(--color-faint)]">
        Pick <b>Full models tree</b> if the folder has ComfyUI-style subfolders (StableDiffusion/, Lora/,
        VAE/…); otherwise pick the single type the folder holds.
      </p>

      {/* Restart nudge */}
      {needsRestart && (
        <div className="mt-3 flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-amber)]/40 bg-[var(--color-amber)]/10 px-3 py-2 text-xs">
          <span className="flex-1 text-[var(--color-text)]">
            Restart ComfyUI so it loads models from the new folder(s).
          </span>
          <button
            type="button"
            onClick={restart}
            disabled={restarting}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-2.5 py-1 font-medium text-[var(--color-on-amber)] disabled:opacity-60"
          >
            {restarting ? <Check className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {restarting ? "Restarting…" : "Restart ComfyUI"}
          </button>
        </div>
      )}

      {picking && (
        <FolderPicker
          initialPath={scanHome}
          onPick={(p) => {
            setScanHome(p);
            setPicking(false);
            void scan(p); // auto-scan the picked folder
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Card>
  );
}
