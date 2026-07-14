import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Grid2x2, Check, RefreshCw, Download, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { PixelArtOpts } from "@latent/shared";

const MODES: { value: PixelArtOpts["mode"]; label: string }[] = [
  { value: "contrast", label: "Contrast (best)" },
  { value: "k_centroid", label: "K-centroid" },
  { value: "nearest", label: "Nearest" },
  { value: "lanczos", label: "Lanczos" },
  { value: "bilinear", label: "Bilinear" },
];
const DITHERS: { value: PixelArtOpts["dither"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "ordered", label: "Ordered" },
  { value: "error_diffusion", label: "Error diffusion" },
];
const QUANTS: { value: PixelArtOpts["quantMode"]; label: string }[] = [
  { value: "weighted-kmeans", label: "Weighted (best)" },
  { value: "kmeans", label: "K-means" },
  { value: "repeat-kmeans", label: "Repeat k-means" },
];

const DEFAULTS: PixelArtOpts = {
  pixelSize: 6,
  thickness: 1,
  mode: "contrast",
  colorQuant: true,
  numColors: 16,
  quantMode: "weighted-kmeans",
  dither: "none",
};

/** Settings: install the pixel-art node + tune the "Pixelate" defaults. */
export function PixelArt() {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["pixel-art-status"],
    queryFn: api.pixelArtStatus,
    // While not installed, poll so the card auto-flips to "Ready" once ComfyUI restarts.
    refetchInterval: (q) => (q.state.data?.installed ? false : 5000),
  });
  const { data } = useQuery({ queryKey: ["pixel-art"], queryFn: api.pixelArtOpts });
  const [opts, setOpts] = useState<PixelArtOpts>(DEFAULTS);
  useEffect(() => {
    if (data) setOpts(data);
  }, [data]);

  const [installing, setInstalling] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installed = status?.installed ?? false;

  /** Persist a change (and reflect it locally immediately). */
  async function commit(patch: Partial<PixelArtOpts>) {
    const next = { ...opts, ...patch };
    setOpts(next);
    const saved = await api.savePixelArtOpts(next);
    qc.setQueryData(["pixel-art"], saved);
  }

  async function install() {
    setInstalling(true);
    setError(null);
    try {
      await api.installPixelArt();
      setNeedsRestart(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  async function restart() {
    setRestarting(true);
    try {
      await api.restartComfy();
      setNeedsRestart(false);
      // ComfyUI takes a bit to come back; re-check install state afterward.
      setTimeout(() => qc.invalidateQueries({ queryKey: ["pixel-art-status"] }), 8000);
    } finally {
      setTimeout(() => setRestarting(false), 8000);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Grid2x2 className="h-4 w-4 text-[var(--color-amber)]" /> Pixel art
      </div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">
        Turn any render into pixel art from the <span className="font-medium">Pixelate</span> button on a
        result. Model-free (PixelOE) — contrast-aware downscale plus optional palette reduction.
      </p>

      {/* Install state */}
      {installed ? (
        <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-good)]/30 bg-[var(--color-good)]/10 px-3 py-2 text-xs text-[var(--color-text)]">
          <Check className="h-3.5 w-3.5 text-[var(--color-good)]" /> Pixel-art node installed and ready.
        </div>
      ) : (
        <div className="mb-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-elevated)]/40 px-3 py-2.5">
          {needsRestart ? (
            <div className="flex items-center gap-3 text-xs">
              <span className="flex-1 text-[var(--color-text)]">Installed — restart ComfyUI to load it.</span>
              <button
                type="button"
                onClick={restart}
                disabled={restarting}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-2.5 py-1 font-medium text-[var(--color-on-amber)] disabled:opacity-60"
              >
                {restarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {restarting ? "Restarting…" : "Restart ComfyUI"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-xs">
              <span className="flex-1 text-[var(--color-muted)]">
                The pixel-art node isn't installed yet. One-click install into your ComfyUI.
              </span>
              <button
                type="button"
                onClick={install}
                disabled={installing}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-2.5 py-1 font-medium text-[var(--color-on-amber)] disabled:opacity-60"
              >
                {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {installing ? "Installing…" : "Install"}
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-[11px] text-[var(--color-danger)]">{error}</p>}
        </div>
      )}

      {/* Controls */}
      <div className="space-y-4">
        <Slider
          label="Pixel size"
          hint="Bigger = chunkier pixels."
          min={1}
          max={32}
          value={opts.pixelSize}
          onChange={(v) => setOpts((o) => ({ ...o, pixelSize: v }))}
          onCommit={(v) => commit({ pixelSize: v })}
        />

        <Slider
          label="Outline"
          hint="Outline expansion — bolder = more sprite-like pop. 0 turns it off."
          min={0}
          max={6}
          value={opts.thickness}
          onChange={(v) => setOpts((o) => ({ ...o, thickness: v }))}
          onCommit={(v) => commit({ thickness: v })}
        />

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs text-[var(--color-muted)]">Reduce colors</label>
            <Toggle on={opts.colorQuant} onChange={(on) => commit({ colorQuant: on })} />
          </div>
          {opts.colorQuant && (
            <div className="space-y-3">
              <Slider
                label="Palette"
                hint="16 is the retro sweet spot; 8 is stricter. Raise it if smooth gradients band."
                min={2}
                max={256}
                value={opts.numColors}
                onChange={(v) => setOpts((o) => ({ ...o, numColors: v }))}
                onCommit={(v) => commit({ numColors: v })}
                unit=" colors"
              />
              <Select
                label="Palette quality"
                value={opts.quantMode}
                options={QUANTS}
                onChange={(v) => commit({ quantMode: v as PixelArtOpts["quantMode"] })}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Downscale"
            value={opts.mode}
            options={MODES}
            onChange={(v) => commit({ mode: v as PixelArtOpts["mode"] })}
          />
          <Select
            label="Dither"
            value={opts.dither}
            options={DITHERS}
            onChange={(v) => commit({ dither: v as PixelArtOpts["dither"] })}
          />
        </div>
      </div>
    </Card>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  value,
  onChange,
  onCommit,
  unit = "",
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  unit?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs text-[var(--color-muted)]">{label}</label>
        <span className="font-mono text-xs text-[var(--color-text)]">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-line-strong)] accent-[var(--color-amber)]"
      />
      {hint && <p className="mt-1 text-[11px] text-[var(--color-faint)]">{hint}</p>}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-[var(--color-muted)]">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2 text-sm outline-none focus:border-[var(--color-amber)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors",
        on ? "bg-[var(--color-amber)]" : "bg-[var(--color-elevated)]",
      )}
    >
      <span
        className={cn(
          "inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[20px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}
