import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ParamValue, WorkflowManifest } from "@latent/shared";
import { isParamVisible } from "@latent/shared";
import { ParamField } from "@/components/controls/ParamField";

/**
 * Every parameter the workflow exposes, grouped by node section — the full
 * power-user surface, auto-derived from /object_info at import time.
 */
export function AdvancedParams({
  manifest,
  values,
  onChange,
}: {
  manifest: WorkflowManifest;
  values: Record<string, ParamValue>;
  onChange: (key: string, value: ParamValue) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof manifest.params>();
    for (const spec of manifest.params) {
      if (!isParamVisible(spec, values)) continue; // hide disabled-feature params
      const section = spec.section ?? "Other";
      const list = map.get(section) ?? [];
      list.push(spec);
      map.set(section, list);
    }
    return [...map.entries()];
  }, [manifest.params, values]);

  // Track open sections so a value edit (re-render) doesn't reset what the user
  // expanded/collapsed. Defaults to the first three sections open.
  const [open, setOpen] = useState<Set<string> | null>(null);
  const openFor = open ?? new Set(groups.slice(0, 3).map(([s]) => s));

  return (
    <div className="space-y-2">
      {groups.map(([section, specs]) => (
        <details
          key={section}
          open={openFor.has(section)}
          onToggle={(e) => {
            // Read `.open` now — React nulls `currentTarget` before the deferred
            // setState updater runs, so reading it in there throws (blanks the app).
            const isOpen = e.currentTarget.open;
            setOpen(() => {
              const next = new Set(openFor);
              isOpen ? next.add(section) : next.delete(section);
              return next;
            });
          }}
          className="group rounded-[var(--radius-sm)] border border-[var(--color-line)]"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-medium text-[var(--color-text)]">
            <span className="flex items-center gap-2">
              {section}
              <span className="font-mono text-[10px] text-[var(--color-faint)]">{specs.length}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--color-faint)] transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t border-[var(--color-line)] px-3 py-4">
            {specs.map((spec) => (
              <ParamField
                key={spec.key}
                spec={spec}
                value={values[spec.key] ?? ""}
                onChange={(v) => onChange(spec.key, v)}
                allValues={values}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
