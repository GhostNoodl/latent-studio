import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const FACTORS: { value: number; label: string; desc: string }[] = [
  {
    value: 1.5,
    label: "1.5×",
    desc: "Refines at 1.5× the source (e.g. 1024 → 1536). Fastest.",
  },
  {
    value: 2,
    label: "2×",
    desc: "Doubles the source (e.g. 1024 → 2048). Sharpest. Runs tiled so it still fits a 16 GB card — just a bit slower.",
  },
];

/** Settings: the "Enhance" upscale factor. Takes effect on the next Enhance (no restart). */
export function EnhanceFactor() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["enhance-factor"], queryFn: api.enhanceFactor });
  const factor = data?.factor ?? 1.5;

  async function pick(f: number) {
    if (f === factor) return;
    await api.saveEnhanceFactor(f);
    qc.invalidateQueries({ queryKey: ["enhance-factor"] });
  }

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Wand2 className="h-4 w-4 text-[var(--color-amber)]" /> Enhance strength
      </div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">
        How far the <span className="font-medium">Enhance</span> button upscales before its detail-refine pass.
        The refine (fixing eyes / microdetail) runs either way.
      </p>

      <div className="space-y-2">
        {FACTORS.map((f) => {
          const active = factor === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => pick(f.value)}
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
                <div className={cn("text-sm", active ? "text-[var(--color-text)]" : "text-[var(--color-muted)]")}>{f.label}</div>
                <div className="text-[11px] leading-relaxed text-[var(--color-faint)]">{f.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
