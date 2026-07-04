import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Download, Loader2, Check, AlertCircle, Server, Play } from "lucide-react";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";
import { confirm } from "@/lib/confirm";
import { cn } from "@/lib/utils";
import type { SetupPhase, SetupStatus } from "@latent/shared";

const PHASE_LABEL: Record<SetupPhase, string> = {
  idle: "",
  downloading: "Downloading ComfyUI portable…",
  extracting: "Unpacking (~6 GB)…",
  launching: "Starting ComfyUI…",
  "installing-nodes": "Installing custom nodes…",
  ready: "Ready",
  failed: "Setup failed",
};

const gb = (b: number) => (b / 1_073_741_824).toFixed(2);

/** First-run ComfyUI setup: detect GPU, download/extract/launch the portable. */
export function SetupPanel({ gate = false }: { gate?: boolean }) {
  const live = useWs((s) => s.setup);
  const { data: initial } = useQuery({
    queryKey: ["setup-status"],
    queryFn: api.setupStatus,
    refetchInterval: (q) => (isBusy((q.state.data as SetupStatus | undefined)?.phase) ? 3000 : false),
  });
  const status = live ?? initial;
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [launching, setLaunching] = useState(false);

  const phase = status?.phase ?? "idle";
  const busy = isBusy(phase);
  const dlPct = status?.total ? Math.round(((status.received ?? 0) / status.total) * 100) : 0;

  async function start(force = false) {
    // Reinstalling re-downloads ~2 GB — confirm so it can't happen by accident.
    if (force) {
      const ok = await confirm({
        title: "Reinstall ComfyUI?",
        body: "This re-downloads the ~2 GB ComfyUI portable and reinstalls all custom nodes over the existing one. Your models are untouched.",
        confirmLabel: "Reinstall",
        danger: true,
      });
      if (!ok) return;
    }
    setStarting(true);
    try {
      await api.startSetup(force);
    } finally {
      setStarting(false);
    }
  }

  async function launch() {
    setLaunching(true);
    await api.launchManaged();
    // Poll until ComfyUI answers (managed launch takes ~15–60s).
    const timer = setInterval(async () => {
      const s = await api.setupStatus();
      qc.setQueryData(["setup-status"], s);
      if (s.comfyReachable) {
        clearInterval(timer);
        setLaunching(false);
      }
    }, 3000);
    setTimeout(() => {
      clearInterval(timer);
      setLaunching(false);
    }, 120_000);
  }

  return (
    <div className="space-y-4">
      {/* Detection */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <InfoTile
          icon={<Server className="h-3.5 w-3.5" />}
          label="ComfyUI"
          value={
            status?.comfyReachable
              ? "Connected"
              : status?.managedInstalled
                ? "Installed (not running)"
                : "Not found"
          }
          tone={status?.comfyReachable ? "good" : status?.managedInstalled ? "amber" : "muted"}
        />
        <InfoTile
          icon={<Cpu className="h-3.5 w-3.5" />}
          label="GPU"
          value={status?.gpu ? (status.gpu.name ?? status.gpu.vendor) : "…"}
          sub={status?.gpu?.vramMb ? `${Math.round(status.gpu.vramMb / 1024)} GB VRAM` : undefined}
        />
      </div>

      {status?.release && (
        <p className="text-xs text-[var(--color-muted)]">
          Portable build: <span className="font-mono text-[var(--color-text)]">{status.release.tag}</span> ·{" "}
          {status.release.asset} · ~{gb(status.release.sizeBytes)} GB
        </p>
      )}

      {/* Progress / result */}
      {busy && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-amber)]" />
            {status?.message ?? PHASE_LABEL[phase]}
          </div>
          {phase === "downloading" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-elevated)]">
              <div
                className="h-full bg-gradient-to-r from-[var(--color-amber)] to-[var(--color-violet)] transition-all"
                style={{ width: `${dlPct}%` }}
              />
            </div>
          )}
          {phase === "downloading" && status?.total ? (
            <div className="text-[10px] text-[var(--color-faint)]">
              {gb(status.received ?? 0)} / {gb(status.total)} GB
            </div>
          ) : null}
        </div>
      )}

      {phase === "ready" && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-good)]">
          <Check className="h-4 w-4" /> ComfyUI is set up and running.
        </div>
      )}
      {phase === "failed" && (
        <div className="flex items-start gap-2 text-xs text-[var(--color-danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{status?.error ?? "Setup failed."}</span>
        </div>
      )}
      {status?.message && !busy && phase !== "failed" && (
        <p className="text-[11px] text-[var(--color-faint)]">{status.message}</p>
      )}

      {/* Action */}
      {!busy && phase !== "ready" && (
        <div className="space-y-2">
          {status?.managedInstalled && !status?.comfyReachable ? (
            <>
              <button
                onClick={launch}
                disabled={launching}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90 disabled:opacity-70"
              >
                {launching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Launching…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> Launch managed ComfyUI
                  </>
                )}
              </button>
              <button
                onClick={() => start(true)}
                disabled={starting}
                className="w-full text-center text-[11px] text-[var(--color-faint)] hover:text-[var(--color-muted)]"
              >
                Reinstall
              </button>
            </>
          ) : (
            <>
              {status?.comfyReachable && !gate && (
                <p className="text-[11px] text-[var(--color-muted)]">
                  You're connected to an external ComfyUI (Stability Matrix). Latent can also install and
                  manage its own — useful for a clean, standalone setup with your existing models shared in.
                </p>
              )}
              <button
                onClick={() => start(false)}
                disabled={starting}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50",
                  gate || !status?.comfyReachable
                    ? "w-full bg-[var(--color-amber)] text-[var(--color-on-amber)] hover:opacity-90"
                    : "border border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
                )}
              >
                <Download className="h-4 w-4" />
                Set up bundled ComfyUI
                {status?.release ? ` (~${gb(status.release.sizeBytes)} GB)` : ""}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function isBusy(phase?: SetupPhase): boolean {
  return phase === "downloading" || phase === "extracting" || phase === "launching" || phase === "installing-nodes";
}

function InfoTile({
  icon,
  label,
  value,
  sub,
  tone = "muted",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "amber" | "muted";
}) {
  const color =
    tone === "good"
      ? "text-[var(--color-good)]"
      : tone === "amber"
        ? "text-[var(--color-amber)]"
        : "text-[var(--color-text)]";
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-ink)] p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
        {icon}
        {label}
      </div>
      <div className={cn("mt-1 truncate text-sm font-medium", color)}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--color-faint)]">{sub}</div>}
    </div>
  );
}
