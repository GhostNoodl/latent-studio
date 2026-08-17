import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, RefreshCw, Check, Eye, Cpu } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { ComfyPerformanceSettings } from "@latent/shared";

type SettingKey = keyof ComfyPerformanceSettings;

const RUNTIME = [
  { value: "stable", label: "Stable", desc: "No experimental math flags. Best baseline for debugging output or crashes." },
  { value: "fast", label: "Fast — recommended", desc: "Uses fp16 accumulation and cuBLAS acceleration without fp8 matrix math or autotune." },
  { value: "experimental", label: "Experimental", desc: "Enables every ComfyUI --fast feature. May change quality, use more workspace memory, or crash." },
] as const;
const PREVIEW = [
  { value: "full", label: "Full previews", desc: "512 px live sampler previews. Best feedback, with some decode and transfer cost." },
  { value: "light", label: "Light previews", desc: "256 px live previews. A mobile-friendly compromise." },
  { value: "off", label: "Previews off", desc: "No sampler previews. Lowest VRAM and processing overhead." },
] as const;
const VRAM = [
  { value: "off", label: "Full precision", desc: "No model precision or offload override." },
  { value: "balanced", label: "Balanced — fp8 model", desc: "Frees several GB of VRAM with a small precision tradeoff." },
  { value: "aggressive", label: "Aggressive — fp8 + offload", desc: "Most headroom, but model offloading makes generation slower." },
] as const;

/** Managed ComfyUI launch profile. Changes wait for an explicit restart. */
export function VramMode() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["comfy-performance"], queryFn: api.comfyPerformance });
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const value = data ?? { runtime: "fast", preview: "full", vram: "off" };

  async function pick<K extends SettingKey>(key: K, next: ComfyPerformanceSettings[K]) {
    if (next === value[key]) return;
    const updated = { ...value, [key]: next };
    const response = await api.saveComfyPerformance(updated);
    qc.setQueryData(["comfy-performance"], updated);
    if (response.needsRestart) setNeedsRestart(true);
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
        <Gauge className="h-4 w-4 text-[var(--color-amber)]" /> ComfyUI performance profile
      </div>
      <p className="mb-5 text-xs text-[var(--color-muted)]">
        Applies to Latent-managed ComfyUI after a restart. Anti-fragmentation remains enabled in every mode.
      </p>
      <ChoiceGroup icon={Cpu} title="Runtime math" setting="runtime" value={value.runtime} choices={RUNTIME} onPick={pick} />
      <ChoiceGroup icon={Eye} title="Live previews" setting="preview" value={value.preview} choices={PREVIEW} onPick={pick} />
      <ChoiceGroup icon={Gauge} title="VRAM strategy" setting="vram" value={value.vram} choices={VRAM} onPick={pick} last />

      {needsRestart && (
        <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-amber)]/40 bg-[var(--color-amber)]/10 px-3 py-2 text-xs">
          <span className="flex-1 text-[var(--color-text)]">Restart ComfyUI when you're ready to apply this profile.</span>
          <button type="button" onClick={restart} disabled={restarting} className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-2.5 py-1 font-medium text-[var(--color-on-amber)] disabled:opacity-60">
            {restarting ? <Check className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {restarting ? "Restarting…" : "Restart ComfyUI"}
          </button>
        </div>
      )}
    </Card>
  );
}

function ChoiceGroup({ icon: Icon, title, setting, value, choices, onPick, last = false }: {
  icon: typeof Gauge;
  title: string;
  setting: SettingKey;
  value: string;
  choices: readonly { value: string; label: string; desc: string }[];
  onPick: <K extends SettingKey>(key: K, value: ComfyPerformanceSettings[K]) => void;
  last?: boolean;
}) {
  return (
    <section className={cn("pb-5", !last && "mb-5 border-b border-[var(--color-line)]")}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium"><Icon className="h-3.5 w-3.5 text-[var(--color-violet)]" /> {title}</div>
      <div className="grid gap-2 lg:grid-cols-3">
        {choices.map((choice) => {
          const active = value === choice.value;
          return (
            <button key={choice.value} type="button" onClick={() => onPick(setting, choice.value as never)} className={cn("rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors", active ? "border-[var(--color-amber)] bg-[var(--color-amber)]/10" : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]")}>
              <div className={cn("flex items-center gap-1.5 text-xs", active ? "text-[var(--color-text)]" : "text-[var(--color-muted)]")}>{active && <Check className="h-3 w-3 text-[var(--color-amber)]" />} {choice.label}</div>
              <div className="mt-1 text-[10px] leading-relaxed text-[var(--color-faint)]">{choice.desc}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
