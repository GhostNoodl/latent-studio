import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Plus, X, Ratio, Sparkle, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { promptText } from "@/lib/prompt-dialog";
import type { ParamValue, Preset, WorkflowManifest } from "@latent/shared";

// Common SDXL sizes (seeded from the user's Stability Matrix saved dimensions).
const DEFAULT_SIZES: [number, number][] = [
  [1024, 1024],
  [832, 1216],
  [1216, 832],
  [896, 1152],
  [1152, 896],
  [768, 1344],
  [1344, 768],
  [768, 768],
];

interface Props {
  manifest: WorkflowManifest;
  values: Record<string, ParamValue>;
  onSet: (key: string, value: ParamValue) => void;
}

export function PresetBar({ manifest, values, onSet }: Props) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: presets = [] } = useQuery({
    queryKey: ["presets", manifest.id],
    queryFn: () => api.presets({ pipelineId: manifest.id }),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["presets", manifest.id] });

  // Locate the pipeline's width/height + prompt params (heuristic by input/label).
  const widthKey = manifest.params.find((p) => p.input === "width")?.key;
  const heightKey = manifest.params.find((p) => p.input === "height")?.key;
  const posKey = manifest.params.find((p) => p.control === "textarea" && /pos/i.test(p.label))?.key;
  const negKey = manifest.params.find((p) => p.control === "textarea" && /neg/i.test(p.label))?.key;

  const styles = presets.filter((p) => p.kind === "style");
  const bundles = presets.filter((p) => p.kind === "bundle");
  const savedSizes = presets.filter((p) => p.kind === "dimensions");

  const sizes = useMemo(() => {
    const fromSaved = savedSizes.map(
      (p) => [Number(p.data.width), Number(p.data.height)] as [number, number],
    );
    const seen = new Set<string>();
    return [...fromSaved, ...DEFAULT_SIZES].filter(([w, h]) => {
      const k = `${w}x${h}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [savedSizes]);

  const curW = widthKey ? Number(values[widthKey]) : undefined;
  const curH = heightKey ? Number(values[heightKey]) : undefined;

  // Organize sizes by orientation, sorted by megapixels within each group.
  const grouped = useMemo(() => {
    const g: Record<"Portrait" | "Square" | "Landscape", [number, number][]> = {
      Portrait: [],
      Square: [],
      Landscape: [],
    };
    for (const [w, h] of sizes) g[w < h ? "Portrait" : w > h ? "Landscape" : "Square"].push([w, h]);
    for (const k of Object.keys(g) as (keyof typeof g)[]) g[k].sort((a, b) => a[0] * a[1] - b[0] * b[1]);
    return g;
  }, [sizes]);

  async function savePreset(kind: Preset["kind"], name: string, data: Record<string, ParamValue>) {
    await api.createPreset({ kind, name, pipelineId: manifest.id, data });
    invalidate();
  }

  return (
    <div className="border-b border-[var(--color-line)] px-4 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--color-faint)] hover:text-[var(--color-muted)]"
      >
        <Bookmark className="h-3 w-3" />
        <span>Presets</span>
        {curW && curH ? (
          <span className="font-mono normal-case text-[var(--color-muted)]">
            {curW}×{curH}
          </span>
        ) : null}
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      <div className={cn("space-y-2", open ? "mt-2.5" : "hidden")}>
        {/* Sizes — grouped by orientation, sorted by megapixels */}
      {widthKey && heightKey && (
        <div className="flex gap-2">
          <span className="flex w-14 shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
            <Ratio className="h-3 w-3" />
            Size
          </span>
          <div className="flex-1 space-y-1.5">
            {(["Portrait", "Square", "Landscape"] as const).map((orient) =>
              grouped[orient].length === 0 ? null : (
                <div key={orient} className="flex items-start gap-2">
                  <span className="mt-1 w-16 shrink-0 text-[9px] uppercase tracking-wide text-[var(--color-faint)]">
                    {orient}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {grouped[orient].map(([w, h]) => (
                      <Chip
                        key={`${w}x${h}`}
                        active={curW === w && curH === h}
                        title={aspectLabel(w, h)}
                        onClick={() => {
                          onSet(widthKey, w);
                          onSet(heightKey, h);
                        }}
                      >
                        {w}×{h}
                      </Chip>
                    ))}
                    {orient === "Portrait" && (
                      <AddChip
                        title="Save current size"
                        onClick={async () => {
                          const name = await promptText({
                            title: "Name this size",
                            defaultValue: `${curW}×${curH}`,
                            placeholder: "e.g. Portrait XL",
                          });
                          if (name) savePreset("dimensions", name, { width: curW!, height: curH! });
                        }}
                      />
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* Styles */}
      {(posKey || negKey) && (
        <Section icon={<Sparkle className="h-3 w-3" />} label="Style">
          {styles.map((s) => (
            <Chip
              key={s.id}
              onClick={() => {
                if (posKey && s.data.positive)
                  onSet(posKey, joinPrompt(String(values[posKey] ?? ""), String(s.data.positive)));
                if (negKey && s.data.negative)
                  onSet(negKey, joinPrompt(String(values[negKey] ?? ""), String(s.data.negative)));
              }}
              onRemove={() => api.deletePreset(s.id).then(invalidate)}
            >
              {s.name}
            </Chip>
          ))}
          <AddChip
            title="Save current prompts as a style"
            onClick={async () => {
              const name = await promptText({ title: "Name this style", placeholder: "e.g. Soft anime" });
              if (name)
                savePreset("style", name, {
                  positive: posKey ? String(values[posKey] ?? "") : "",
                  negative: negKey ? String(values[negKey] ?? "") : "",
                });
            }}
          />
        </Section>
      )}

      {/* Full-settings bundles */}
      <Section icon={<Bookmark className="h-3 w-3" />} label="Preset">
        {bundles.map((b) => (
          <Chip
            key={b.id}
            onClick={() => {
              for (const [k, v] of Object.entries(b.data)) onSet(k, v);
            }}
            onRemove={() => api.deletePreset(b.id).then(invalidate)}
          >
            {b.name}
          </Chip>
        ))}
        <AddChip
          title="Save all current settings"
          onClick={async () => {
            const name = await promptText({ title: "Name this preset", placeholder: "e.g. My go-to setup" });
            if (name) savePreset("bundle", name, { ...values });
          }}
        />
      </Section>
      </div>
    </div>
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-14 shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
        {icon}
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  children,
  active,
  title,
  onClick,
  onRemove,
}: {
  children: React.ReactNode;
  active?: boolean;
  title?: string;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <span
      title={title}
      className={cn(
        "group inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
        active
          ? "border-[var(--color-amber)] bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
          : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
      )}
    >
      <button onClick={onClick} className="font-mono">
        {children}
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          title="Delete preset"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

function AddChip({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="grid h-[18px] w-[18px] place-items-center rounded-full border border-dashed border-[var(--color-line-strong)] text-[var(--color-faint)] hover:border-[var(--color-amber)] hover:text-[var(--color-amber)]"
    >
      <Plus className="h-2.5 w-2.5" />
    </button>
  );
}

function aspectLabel(w: number, h: number): string {
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function joinPrompt(current: string, addition: string): string {
  const c = current.trim();
  if (!c) return addition;
  if (c.includes(addition.trim())) return current;
  return `${c}, ${addition}`;
}
