import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, RefreshCw, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Mode = "off" | "balanced" | "aggressive";

const MODES: { value: Mode; label: string; desc: string }[] = [
  { value: "off", label: "Full quality", desc: "No VRAM tricks. Best quality, highest VRAM use." },
  {
    value: "balanced",
    label: "Balanced — fp8",
    desc: "Loads the model in 8-bit: frees ~2.5–3 GB with a tiny precision cost. The one to pick if you hit out-of-memory.",
  },
  {
    value: "aggressive",
    label: "Aggressive — fp8 + offload",
    desc: "Also offloads the model between steps: biggest savings, but noticeably slower. For squeezing a heavy job onto the card.",
  },
];

/** Settings: choose a VRAM-saving mode (fp8 / lowvram launch flags). Needs a restart. */
export function VramMode() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["vram-mode"], queryFn: api.vramMode });
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const mode = data?.mode ?? "off";

  async function pick(m: Mode) {
    if (m === mode) return;
    const res = await api.saveVramMode(m);
    qc.invalidateQueries({ queryKey: ["vram-mode"] });
    if (res.needsRestart) setNeedsRestart(true);
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
        <Gauge className="h-4 w-4 text-[var(--color-amber)]" /> VRAM saving
      </div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">
        Trade a little quality or speed for headroom on a tight GPU. Takes effect when ComfyUI restarts.
        (Faster-math <span className="font-mono">--fast</span> and anti-fragmentation are always on.)
      </p>

      <div className="space-y-2">
        {MODES.map((m) => {
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => pick(m.value)}
              className={cn(
                "flex w-full items-start gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-[var(--color-amber)] bg-[var(--color-amber)]/10"
                  : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                  active ? "border-[var(--color-amber)] bg-[var(--color-amber)] text-[var(--color-on-amber)]" : "border-[var(--color-line-strong)]",
                )}
              >
                {active && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <div className="min-w-0">
                <div className={cn("text-sm", active ? "text-[var(--color-text)]" : "text-[var(--color-muted)]")}>{m.label}</div>
                <div className="text-[11px] leading-relaxed text-[var(--color-faint)]">{m.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {needsRestart && (
        <div className="mt-3 flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-amber)]/40 bg-[var(--color-amber)]/10 px-3 py-2 text-xs">
          <span className="flex-1 text-[var(--color-text)]">Restart ComfyUI to apply the new VRAM mode.</span>
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
