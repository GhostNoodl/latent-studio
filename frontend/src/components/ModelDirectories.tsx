import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive, FolderPlus, X, RefreshCw, Loader2, Check, AlertCircle } from "lucide-react";
import type { CustomModelPath, ModelKind } from "@latent/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/primitives";
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
    </Card>
  );
}
