import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, ChevronUp, X, Check, Loader2, AlertCircle, Info } from "lucide-react";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";
import { useNotifications, type Notification } from "@/lib/notifications";
import { formatRelative, cn } from "@/lib/utils";
import type { DownloadJob } from "@latent/shared";

/** Permanent bottom-left hub: live download progress + persisted history. */
export function NotificationCenter() {
  const downloads = useWs((s) => s.downloads);
  const items = useNotifications((s) => s.items);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const remove = useNotifications((s) => s.remove);
  const clear = useNotifications((s) => s.clear);
  const [open, setOpen] = useState(false);

  const active = Object.values(downloads)
    .filter((d) => d.status === "downloading")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const unread = items.filter((i) => !i.read).length;

  function toggle() {
    setOpen((v) => {
      if (!v) markAllRead();
      return !v;
    });
  }

  return (
    <div className="fixed bottom-20 left-4 z-40 md:bottom-6 md:left-6">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className="mb-2 w-80 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2">
              <span className="text-xs font-medium text-[var(--color-text)]">Notifications</span>
              {items.length > 0 && (
                <button
                  onClick={clear}
                  className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-danger)]"
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="max-h-[26rem] overflow-y-auto p-2">
              {/* Live downloads */}
              {active.length > 0 && (
                <div className="mb-1 space-y-1">
                  {active.map((job) => (
                    <ActiveDownload key={job.id} job={job} />
                  ))}
                </div>
              )}

              {/* History */}
              {items.map((n) => (
                <NotifRow key={n.id} n={n} onDismiss={() => remove(n.id)} />
              ))}

              {active.length === 0 && items.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-[var(--color-faint)]">
                  Nothing yet — finished downloads and alerts show up here.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={toggle}
        className="flex items-center gap-2.5 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-elevated)] py-2 pl-3 pr-4 shadow-xl"
      >
        {active.length > 0 ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-amber)]" />
        ) : (
          <span className="relative">
            <Bell className="h-4 w-4 text-[var(--color-amber)]" />
            {unread > 0 && (
              <span className="absolute -right-1.5 -top-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[var(--color-amber)] px-1 text-[9px] font-bold text-[var(--color-on-amber)]">
                {unread}
              </span>
            )}
          </span>
        )}
        <span className="text-xs font-medium">
          {active.length > 0 ? `${active.length} downloading` : "Notifications"}
        </span>
        <ChevronUp
          className={"h-3.5 w-3.5 text-[var(--color-faint)] transition-transform " + (open ? "rotate-180" : "")}
        />
      </button>
    </div>
  );
}

function ActiveDownload({ job }: { job: DownloadJob }) {
  const pct = job.total ? Math.round((job.received / job.total) * 100) : 0;
  const mb = (b: number) => (b / 1_048_576).toFixed(0);
  return (
    <div className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1.5">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--color-amber)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-[var(--color-text)]">{job.name}</div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--color-elevated)]">
          <div
            className="h-full bg-gradient-to-r from-[var(--color-amber)] to-[var(--color-violet)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-0.5 text-[10px] text-[var(--color-faint)]">
          {mb(job.received)}{job.total ? ` / ${mb(job.total)}` : ""} MB · {job.kind}
        </div>
      </div>
      <button
        onClick={() => api.cancelDownload(job.id)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--color-faint)] transition-colors hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
        title="Cancel"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function NotifRow({ n, onDismiss }: { n: Notification; onDismiss: () => void }) {
  const Icon = n.status === "success" ? Check : n.status === "error" ? AlertCircle : Info;
  const tone =
    n.status === "success"
      ? "text-[var(--color-good)]"
      : n.status === "error"
        ? "text-[var(--color-danger)]"
        : "text-[var(--color-violet)]";
  return (
    <div className="group flex items-start gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1.5 hover:bg-[var(--color-elevated)]">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-[var(--color-text)]">{n.title}</div>
        {n.body && <div className="truncate text-[10px] text-[var(--color-faint)]">{n.body}</div>}
        <div className="text-[10px] text-[var(--color-faint)]">{formatRelative(new Date(n.at).toISOString())}</div>
      </div>
      <button
        onClick={onDismiss}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--color-faint)] opacity-0 transition-opacity hover:text-[var(--color-text)] group-hover:opacity-100"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
