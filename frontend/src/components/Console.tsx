import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, X, Copy, Trash2, Power, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useLogs } from "@/lib/logs";
import { useShutdown } from "@/lib/shutdown";
import { cn } from "@/lib/utils";
import type { LogSource } from "@latent/shared";

/** Open/close state for the log console, so the sidebar button can toggle it. */
export const useConsole = create<{ open: boolean; toggle: () => void; set: (v: boolean) => void }>(
  (set) => ({ open: false, toggle: () => set((s) => ({ open: !s.open })), set: (v) => set({ open: v }) }),
);

type Filter = "all" | LogSource;

/** Right-side drawer showing captured backend + ComfyUI output; also hosts Quit. */
export function Console() {
  const open = useConsole((s) => s.open);
  const setOpen = useConsole((s) => s.set);
  const items = useLogs((s) => s.items);
  const seeded = useLogs((s) => s.seeded);
  const seed = useLogs((s) => s.seed);
  const clear = useLogs((s) => s.clear);
  const [filter, setFilter] = useState<Filter>("all");
  const quitting = useShutdown((s) => s.quitting);
  const stopped = useShutdown((s) => s.stopped);
  const quit = useShutdown((s) => s.quit);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Seed the backlog snapshot the first time the console opens.
  useEffect(() => {
    if (open && !seeded) api.logs().then((r) => seed(r.entries)).catch(() => {});
  }, [open, seeded, seed]);

  const shown = filter === "all" ? items : items.filter((i) => i.source === filter);

  // Auto-scroll to the newest line while the user is pinned to the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, open]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  async function copyAll() {
    await navigator.clipboard?.writeText(shown.map((i) => i.text).join("\n")).catch(() => {});
  }

  if (stopped) {
    return (
      <div className="fixed inset-0 z-[90] grid place-items-center bg-[var(--color-ink)] text-center">
        <div className="space-y-2">
          <Power className="mx-auto h-8 w-8 text-[var(--color-muted)]" />
          <div className="font-display text-lg font-semibold text-[var(--color-text)]">Latent has stopped</div>
          <p className="text-sm text-[var(--color-muted)]">ComfyUI was shut down too. You can close this tab.</p>
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex justify-end bg-black/40 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.aside
            className="flex h-full w-full max-w-2xl flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
            initial={{ x: 40, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
              <Terminal className="h-4 w-4 text-[var(--color-amber)]" />
              <span className="font-display text-sm font-semibold text-[var(--color-text)]">Console</span>
              <div className="ml-2 flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-strong)]">
                {(["all", "backend", "comfy"] as Filter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] uppercase tracking-wide transition-colors",
                      filter === f
                        ? "bg-[var(--color-elevated)] text-[var(--color-text)]"
                        : "text-[var(--color-faint)] hover:text-[var(--color-muted)]",
                    )}
                  >
                    {f === "comfy" ? "ComfyUI" : f}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-1">
                <IconBtn title="Copy all" onClick={copyAll}>
                  <Copy className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Clear view" onClick={clear}>
                  <Trash2 className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Close" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </IconBtn>
              </div>
            </div>

            {/* Log stream */}
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-ink)] px-3 py-2 font-mono text-[11px] leading-relaxed"
            >
              {shown.length === 0 ? (
                <div className="grid h-full place-items-center text-[var(--color-faint)]">
                  {seeded ? "No output yet." : "Loading…"}
                </div>
              ) : (
                shown.map((e) => (
                  <div key={e.id} className="flex gap-2 whitespace-pre-wrap break-words">
                    <span
                      className={cn(
                        "shrink-0 select-none",
                        e.source === "comfy" ? "text-[var(--color-violet)]" : "text-[var(--color-faint)]",
                      )}
                    >
                      {e.source === "comfy" ? "comfy" : "latent"}
                    </span>
                    <span
                      className={cn(
                        e.level === "error"
                          ? "text-[var(--color-danger)]"
                          : e.level === "warn"
                            ? "text-[var(--color-amber)]"
                            : "text-[var(--color-muted)]",
                      )}
                    >
                      {e.text}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Footer: Quit */}
            <div className="flex items-center justify-between border-t border-[var(--color-line)] px-4 py-3">
              <span className="text-[11px] text-[var(--color-faint)]">
                {shown.length} lines · live
              </span>
              <button
                onClick={quit}
                disabled={quitting}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-danger)]/40 px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10 disabled:opacity-60"
              >
                {quitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                {quitting ? "Stopping…" : "Quit Latent"}
              </button>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--color-faint)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
    >
      {children}
    </button>
  );
}
