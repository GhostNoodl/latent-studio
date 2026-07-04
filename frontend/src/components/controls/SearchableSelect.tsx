import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** A clean, searchable dropdown — replaces the native <select> for enum params. */
export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  // When opened near the bottom of a scroll container, pull the option list into
  // view so you can see the choices without manually scrolling.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 20);
    return () => clearTimeout(t);
  }, [open]);
  // Guard against non-string options (e.g. a boolean [false,true] enum) — React
  // renders boolean children as nothing, which would show blank, unselectable rows.
  const safeOptions = useMemo(() => options.map((o) => String(o)), [options]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? safeOptions.filter((o) => o.toLowerCase().includes(t)) : safeOptions;
  }, [safeOptions, q]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 text-sm text-[var(--color-text)] hover:border-[var(--color-amber)]"
      >
        <span className="truncate">{value || <span className="text-[var(--color-faint)]">{placeholder}</span>}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-faint)]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            className="absolute z-30 mt-1 w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-elevated)] shadow-2xl"
          >
            {options.length > 8 && (
              <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-[var(--color-faint)]" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter…"
                  className="h-5 w-full bg-transparent text-xs outline-none placeholder:text-[var(--color-faint)]"
                />
              </div>
            )}
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                    setQ("");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs",
                    o === value ? "text-[var(--color-amber)]" : "text-[var(--color-text)] hover:bg-[var(--color-line)]",
                  )}
                >
                  <span className="truncate">{o}</span>
                  {o === value && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-xs text-[var(--color-faint)]">No matches.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
