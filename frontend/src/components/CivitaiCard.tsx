import { useState } from "react";
import { Download, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { CivitaiModelResult } from "@latent/shared";

/** A Civitai search-result card: cover image + quick-download of the latest version. */
export function CivitaiCard({
  model,
  onOpen,
  onCreator,
}: {
  model: CivitaiModelResult;
  onOpen: () => void;
  onCreator?: (username: string) => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useWs((s) => (jobId ? s.downloads[jobId] : undefined));
  const version = model.versions[0];

  async function download(e: React.MouseEvent) {
    e.stopPropagation();
    if (!version) return;
    try {
      const j = await api.startDownload(model.id, version.id);
      setJobId(j.id);
    } catch (err) {
      console.error(err);
    }
  }

  const status = job?.status;
  const pct = job && job.total ? Math.round((job.received / job.total) * 100) : 0;

  // The cover prefers a still image, but a video-only model needs a <video> tag.
  const coverIsVideo =
    model.versions.flatMap((v) => v.images).find((i) => i.url === model.cover)?.type === "video";

  return (
    <button
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border-2 border-[var(--color-line-strong)] bg-[var(--color-surface)] text-left transition-colors hover:border-[var(--color-amber)]/50"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-[var(--color-ink)]">
        {model.cover ? (
          coverIsVideo ? (
            <video
              src={model.cover}
              muted
              loop
              playsInline
              autoPlay
              preload="metadata"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <img
              src={model.cover}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          )
        ) : (
          <div className="grid h-full place-items-center text-xs text-[var(--color-faint)]">no preview</div>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          <Badge tone="neutral">{model.type}</Badge>
          {version?.baseModel && <Badge tone="violet">{version.baseModel}</Badge>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--color-text)]">{model.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-faint)]">
            {model.author &&
              (onCreator ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreator(model.author!);
                  }}
                  className="truncate transition-colors hover:text-[var(--color-amber)]"
                >
                  by {model.author}
                </span>
              ) : (
                <span className="truncate">by {model.author}</span>
              ))}
            {model.stats.downloadCount != null && <span>↓ {formatCount(model.stats.downloadCount)}</span>}
          </div>
        </div>

        {/* Download control */}
        <div
          role="button"
          tabIndex={0}
          onClick={download}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && download(e as unknown as React.MouseEvent)}
          className={cn(
            "relative mt-auto flex h-8 items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-sm)] text-xs font-medium transition-colors",
            status === "completed"
              ? "bg-[var(--color-good)]/15 text-[var(--color-good)]"
              : status === "failed"
                ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
                : "bg-[var(--color-elevated)] text-[var(--color-text)] hover:bg-[var(--color-amber)] hover:text-[var(--color-on-amber)]",
          )}
        >
          {status === "downloading" && (
            <span
              className="absolute inset-y-0 left-0 bg-[var(--color-amber)]/25"
              style={{ width: `${pct}%` }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            {status === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {pct}%
              </>
            ) : status === "completed" ? (
              <>
                <Check className="h-3.5 w-3.5" /> Installed
              </>
            ) : status === "failed" ? (
              "Failed — retry"
            ) : (
              <>
                <Download className="h-3.5 w-3.5" /> Download
              </>
            )}
          </span>
        </div>
      </div>
    </button>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
