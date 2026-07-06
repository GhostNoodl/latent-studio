import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { ModelPickerDialog, Thumb } from "./ModelPicker";
import { cn } from "@/lib/utils";
import type { LoraEntry } from "@latent/shared";

export function LoraControl({
  value,
  onChange,
  onAddTriggers,
}: {
  value: LoraEntry[];
  onChange: (value: LoraEntry[]) => void;
  onAddTriggers?: (words: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const { data: loras = [] } = useQuery({
    queryKey: ["models", "lora"],
    queryFn: () => api.models("lora"),
    staleTime: 60_000,
  });
  const byFile = useMemo(() => new Map(loras.map((m) => [m.file, m])), [loras]);
  const options = useMemo(() => loras.map((m) => m.file), [loras]);

  // Tolerate a non-array value (e.g. the empty default before hydration).
  const list = Array.isArray(value) ? value : [];

  const update = (i: number, patch: Partial<LoraEntry>) =>
    onChange(list.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(list.filter((_, idx) => idx !== i));
  const add = (file: string) => {
    if (!list.some((l) => l.lora === file)) onChange([...list, { on: true, lora: file, strength: 1 }]);
    const words = byFile.get(file)?.trainedWords;
    if (words?.length && onAddTriggers) onAddTriggers(words.join(", "));
    setAdding(false);
  };

  return (
    <div className="space-y-2">
      {list.map((l, i) => {
        const m = byFile.get(l.lora);
        return (
          <div
            key={l.lora}
            className={cn(
              "flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-ink)] p-1.5",
              !l.on && "opacity-50",
            )}
          >
            {/* on/off */}
            <button
              type="button"
              onClick={() => update(i, { on: !l.on })}
              title={l.on ? "Disable" : "Enable"}
              className={cn(
                "h-4 w-4 shrink-0 rounded-full border",
                l.on
                  ? "border-[var(--color-amber)] bg-[var(--color-amber)]"
                  : "border-[var(--color-line-strong)]",
              )}
            />
            {/* thumb (falls back to a cube if the preview is missing/broken) */}
            <Thumb kind="lora" model={m} file={l.lora} className="h-8 w-8 shrink-0 rounded-[var(--radius-xs)]" />
            {/* name + triggers */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-[var(--color-text)]">{m?.name ?? l.lora}</div>
              {m?.trainedWords && m.trainedWords.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {m.trainedWords.slice(0, 3).map((w) => (
                    <span
                      key={w}
                      onClick={() => navigator.clipboard?.writeText(w)}
                      title="Copy trigger word"
                      className="cursor-pointer rounded bg-[var(--color-surface)] px-1 py-px font-mono text-[9px] text-[var(--color-amber)]"
                    >
                      {w}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* strength */}
            <input
              type="number"
              value={l.strength}
              step={0.05}
              min={-2}
              max={3}
              onChange={(e) => update(i, { strength: Number(e.target.value) })}
              className="h-7 w-14 shrink-0 rounded-[var(--radius-xs)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1.5 text-center font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="shrink-0 text-[var(--color-faint)] hover:text-[var(--color-danger)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] py-2 text-xs text-[var(--color-muted)] hover:border-[var(--color-amber)] hover:text-[var(--color-amber)]"
      >
        <Plus className="h-3.5 w-3.5" /> Add LoRA
      </button>

      <AnimatePresence>
        {adding && (
          <ModelPickerDialog
            kind="lora"
            options={options}
            value=""
            byFile={byFile}
            onPick={add}
            onClose={() => setAdding(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
