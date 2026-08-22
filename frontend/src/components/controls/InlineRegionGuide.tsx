import { useMemo } from "react";
import { Map, TriangleAlert } from "lucide-react";
import { parseInlineRegions } from "@latent/shared";

const REGION_COLORS = [
  "rgba(245, 158, 11, 0.24)",
  "rgba(139, 92, 246, 0.24)",
  "rgba(34, 197, 94, 0.22)",
  "rgba(14, 165, 233, 0.22)",
  "rgba(244, 63, 94, 0.22)",
  "rgba(20, 184, 166, 0.22)",
  "rgba(249, 115, 22, 0.22)",
  "rgba(168, 85, 247, 0.22)",
];

export function InlineRegionGuide({ value }: { value: string }) {
  const parsed = useMemo(() => parseInlineRegions(value), [value]);
  const active = parsed.regions.length > 0 || parsed.errors.length > 0 || /\bREGION\b/i.test(value);
  return (
    <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)]/55 px-3 py-2" data-testid="inline-region-guide">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
          <Map className="h-3.5 w-3.5 text-[var(--color-violet)]" />
          <span>{parsed.regions.length ? `${parsed.regions.length} inline region${parsed.regions.length === 1 ? "" : "s"} active` : "Regions: add REGION(left): your prompt on a new line"}</span>
        </div>
        <details className="text-[10px] text-[var(--color-faint)]">
          <summary className="cursor-pointer select-none hover:text-[var(--color-muted)]">Syntax</summary>
          <div className="mt-2 max-w-lg space-y-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-ink)] p-2.5 font-mono leading-relaxed text-[var(--color-muted)]">
            <div>REGION(left): orange fox, green jacket</div>
            <div>REGION(right, 1.2): blue wolf, red hoodie</div>
            <div>REGION(0%, 0%, 50%, 100%): custom area</div>
            <div className="font-sans text-[var(--color-faint)]">Presets: left, right, top, bottom, corners, center, background. Up to eight regions.</div>
          </div>
        </details>
      </div>
      {active && parsed.regions.length > 0 && (
        <div className="mt-2 flex items-start gap-3">
          <div className="relative aspect-[4/3] w-32 shrink-0 overflow-hidden rounded border border-[var(--color-line-strong)] bg-[var(--color-ink)]" aria-label="Inline regional prompt layout preview" data-testid="inline-region-preview">
            {parsed.regions.map((region, index) => (
              <div key={`${region.line}-${index}`} className="absolute grid place-items-center border border-white/50 text-[9px] font-bold text-white" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%`, background: REGION_COLORS[index % REGION_COLORS.length] }} title={`${region.name} · strength ${region.strength} · ${region.prompt}`}>R{index + 1}</div>
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            {parsed.regions.map((region, index) => (
              <div key={`${region.line}-${region.name}`} className="flex min-w-0 items-baseline gap-1.5 text-[10px]">
                <span className="shrink-0 font-mono text-[var(--color-violet)]">R{index + 1}</span>
                <span className="shrink-0 text-[var(--color-muted)]">{region.name}</span>
                {region.strength !== 1 && <span className="shrink-0 text-[var(--color-faint)]">×{region.strength}</span>}
                <span className="truncate text-[var(--color-faint)]">{region.prompt}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {parsed.errors.length > 0 && (
        <div className="mt-2 space-y-1" role="alert" data-testid="inline-region-errors">
          {parsed.errors.map((error, index) => (
            <div key={`${error.line}-${index}`} className="flex items-start gap-1.5 text-[10px] text-[var(--color-danger)]"><TriangleAlert className="mt-px h-3 w-3 shrink-0" /><span>Line {error.line}: {error.message}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
