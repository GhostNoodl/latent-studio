import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ChevronDown, X, Trash2, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";
import { Mono } from "@/components/ui/primitives";
import { seedFingerprint } from "@/lib/utils";
import type { QueueItem } from "@latent/shared";

/**
 * App-wide activity dock: the live ComfyUI queue (running + pending) with
 * per-item cancel and a clear-all, so batch runs stay visible and controllable
 * from any screen.
 */
export function QueueIndicator() {
  const live = useWs((s) => s.live);
  const queueRemaining = useWs((s) => s.queueRemaining);
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const activeIds = Object.keys(live);
  const active = activeIds.length > 0 || queueRemaining > 0;

  const { data: queue } = useQuery({
    queryKey: ["queue"],
    queryFn: () => api.queue(),
    refetchInterval: active ? 1200 : false,
  });

  // When activity ends, do one final refetch so the cached snapshot doesn't
  // linger as phantom "ghost" rows.
  useEffect(() => {
    if (!active) queryClient.invalidateQueries({ queryKey: ["queue"] });
  }, [active, queryClient]);

  // Ignore any stale snapshot when nothing is actually active.
  const running = active ? (queue?.running ?? []) : [];
  const pending = active ? (queue?.pending ?? []) : [];
  const total = running.length + pending.length;

  if (!active) return null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["generations"] });
  };
  const cancel = async (item: QueueItem) => {
    await api.cancelQueued(item.promptId, item.running);
    refresh();
  };
  const clearAll = async () => {
    await api.clearQueue();
    refresh();
  };

  const label = running.length > 0 ? `${running.length} generating` : `${total || queueRemaining} queued`;

  return (
    <div className="fixed bottom-20 right-4 z-40 md:bottom-6 md:right-6">
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className="mb-2 w-80 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2">
              <span className="text-xs font-medium text-[var(--color-text)]">
                Queue · {total || queueRemaining}
              </span>
              {pending.length > 0 && (
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1 text-[11px] text-[var(--color-faint)] hover:text-[var(--color-danger)]"
                >
                  <Trash2 className="h-3 w-3" /> Clear queue
                </button>
              )}
            </div>
            <div className="max-h-96 space-y-1.5 overflow-y-auto p-2">
              {running.map((item) => (
                <QueueRow key={item.promptId} item={item} live={item.generationId ? live[item.generationId] : undefined} onCancel={cancel} />
              ))}
              {pending.map((item, i) => (
                <QueueRow key={item.promptId} item={item} position={i + 1} onCancel={cancel} />
              ))}
              {total === 0 && (
                <p className="px-2 py-3 text-center text-xs text-[var(--color-faint)]">Queue is empty.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2.5 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-elevated)] py-2 pl-3 pr-4 shadow-xl"
      >
        {running.length > 0 ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-amber)]" />
        ) : (
          <Clock className="h-4 w-4 text-[var(--color-amber)]" />
        )}
        <span className="text-xs font-medium">{label}</span>
        <ChevronDown
          className={"h-3.5 w-3.5 text-[var(--color-faint)] transition-transform " + (expanded ? "rotate-180" : "")}
        />
      </button>
    </div>
  );
}

function QueueRow({
  item,
  live,
  position,
  onCancel,
}: {
  item: QueueItem;
  live?: { value: number; max: number; preview?: string };
  position?: number;
  onCancel: (item: QueueItem) => void;
}) {
  const pct = live && live.max > 0 ? Math.round((live.value / live.max) * 100) : 0;
  return (
    <div className="group flex items-center gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1.5 hover:bg-[var(--color-elevated)]">
      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-xs)] bg-[var(--color-ink)]">
        {live?.preview ? (
          <img src={live.preview} alt="" className="h-full w-full object-cover" />
        ) : item.thumbnail ? (
          <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="font-mono text-[10px] text-[var(--color-faint)]">{position ?? "•"}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-[var(--color-text)]">
            {item.pipelineName ?? "Generation"}
          </span>
          <Mono className="text-[10px]">{seedFingerprint(item.seed)}</Mono>
        </div>
        {item.running ? (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--color-elevated)]">
            <div
              className="h-full bg-gradient-to-r from-[var(--color-amber)] to-[var(--color-violet)] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : (
          <span className="text-[10px] text-[var(--color-faint)]">Queued · #{position}</span>
        )}
      </div>
      <button
        onClick={() => onCancel(item)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--color-faint)] transition-colors hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
        title={item.running ? "Stop" : "Remove from queue"}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
