import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, RefreshCw, X, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Slim top bar shown when a newer version is on GitHub. "Restart & update" exits the
 * backend with code 42 → the launcher pulls + rebuilds + relaunches; we then wait for
 * the app to come back and reload into the new version.
 */
export function UpdateBanner() {
  const { data } = useQuery({
    queryKey: ["update-status"],
    queryFn: api.updateStatus,
    refetchInterval: 15 * 60 * 1000, // check every 15 min
    staleTime: 5 * 60 * 1000,
  });
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  if (updating) return <UpdatingOverlay />;
  if (!data?.available || dismissed) return null;

  async function apply() {
    setUpdating(true);
    await api.applyUpdate().catch(() => {}); // backend exits → launcher restarts
  }

  return (
    <div className="flex items-center gap-2.5 border-b border-[var(--color-amber)]/30 bg-[var(--color-amber)]/10 px-4 py-2 text-xs">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--color-amber)]" />
      <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">
        A new version of Latent is available{data.behind > 1 ? ` — ${data.behind} updates` : ""}
        {data.subject ? (
          <span className="text-[var(--color-muted)]"> · {data.subject}</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={apply}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-2.5 py-1 font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Restart &amp; update
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        title="Dismiss"
        className="shrink-0 rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Full-screen "updating…" cover that waits for the relaunched app, then reloads. */
function UpdatingOverlay() {
  useEffect(() => {
    let alive = true;
    let sawDown = false;
    (async () => {
      while (alive) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const r = await fetch("/api/health", { signal: AbortSignal.timeout(2000) });
          if (r.ok && sawDown) {
            window.location.reload();
            return;
          }
          if (!r.ok) sawDown = true;
        } catch {
          sawDown = true; // backend went down → it's restarting
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[var(--color-ink)]/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-[var(--color-amber)]" />
        <div className="text-sm font-medium text-[var(--color-text)]">Updating Latent…</div>
        <div className="max-w-xs text-xs text-[var(--color-muted)]">
          Pulling the latest, rebuilding, and restarting. This takes a minute — the app
          will reload itself when it's back.
        </div>
      </div>
    </div>
  );
}
