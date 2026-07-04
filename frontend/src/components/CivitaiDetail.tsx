import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { X, Download, Check, Loader2, ExternalLink, Heart, Star, ArrowDownToLine, Play } from "lucide-react";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { CivitaiModelResult } from "@latent/shared";

/** Detail modal: image gallery, version picker, description, stats, download. */
export function CivitaiDetail({
  model,
  onClose,
  onCreator,
}: {
  model: CivitaiModelResult;
  onClose: () => void;
  onCreator?: (username: string) => void;
}) {
  // Fetch the complete record (full description, every version + file) on open.
  const { data: full } = useQuery({
    queryKey: ["civitai-model", model.id],
    queryFn: () => api.civitaiModel(model.id),
    staleTime: 300_000,
  });
  const m = full ?? model;
  const [versionId, setVersionId] = useState(model.versions[0]?.id ?? 0);
  const version = m.versions.find((v) => v.id === versionId) ?? m.versions[0];
  const description = htmlToText(m.description);
  const [hero, setHero] = useState(version?.images[0]?.url);
  const heroIsVideo = version?.images.find((i) => i.url === hero)?.type === "video";
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useWs((s) => (jobId ? s.downloads[jobId] : undefined));

  useEffect(() => setHero(version?.images[0]?.url), [versionId, version]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const file = version?.files.find((f) => f.primary) ?? version?.files[0];
  const status = job?.status;
  const pct = job && job.total ? Math.round((job.received / job.total) * 100) : 0;

  async function download() {
    if (!version) return;
    try {
      const j = await api.startDownload(model.id, version.id);
      setJobId(j.id);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="flex max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
        initial={{ scale: 0.97, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gallery */}
        <div className="hidden w-[46%] flex-col bg-black md:flex">
          <div className="flex flex-1 items-center justify-center overflow-hidden p-3">
            {hero ? (
              heroIsVideo ? (
                <video
                  src={hero}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="max-h-full max-w-full rounded-[var(--radius-sm)] object-contain"
                />
              ) : (
                <img src={hero} alt="" className="max-h-full max-w-full rounded-[var(--radius-sm)] object-contain" />
              )
            ) : (
              <span className="text-xs text-[var(--color-faint)]">no preview</span>
            )}
          </div>
          {version && version.images.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto p-2">
              {version.images.slice(0, 12).map((img) => (
                <button
                  key={img.url}
                  onClick={() => setHero(img.url)}
                  className={cn(
                    "relative h-12 w-12 shrink-0 overflow-hidden rounded-[var(--radius-xs)] border",
                    hero === img.url ? "border-[var(--color-amber)]" : "border-transparent",
                  )}
                >
                  {img.type === "video" ? (
                    <>
                      <video src={img.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                      <Play className="absolute inset-0 m-auto h-4 w-4 text-white/90 drop-shadow" fill="currentColor" />
                    </>
                  ) : (
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-2 border-b border-[var(--color-line)] px-5 py-4">
            <div className="min-w-0">
              <div className="font-display text-base font-semibold text-[var(--color-text)]">{m.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)]">
                <Badge tone="neutral">{m.type}</Badge>
                {m.author &&
                  (onCreator ? (
                    <button
                      onClick={() => onCreator(m.author!)}
                      className="inline-flex items-center gap-1 transition-colors hover:text-[var(--color-amber)]"
                    >
                      {m.authorImage && (
                        <img src={m.authorImage} alt="" className="h-4 w-4 rounded-full object-cover" />
                      )}
                      by {m.author}
                    </button>
                  ) : (
                    <span>by {m.author}</span>
                  ))}
                <a
                  href={`https://civitai.com/models/${m.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-[var(--color-violet)] hover:underline"
                >
                  Civitai <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--color-faint)]">
                {m.stats.downloadCount != null && (
                  <span className="inline-flex items-center gap-1">
                    <ArrowDownToLine className="h-3 w-3" /> {formatCount(m.stats.downloadCount)}
                  </span>
                )}
                {m.stats.thumbsUpCount != null && (
                  <span className="inline-flex items-center gap-1">
                    <Heart className="h-3 w-3" /> {formatCount(m.stats.thumbsUpCount)}
                  </span>
                )}
                {m.stats.rating != null && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3" /> {m.stats.rating.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Version */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-muted)]">Version</label>
              <select
                value={versionId}
                onChange={(e) => setVersionId(Number(e.target.value))}
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2 text-sm outline-none focus:border-[var(--color-amber)]"
              >
                {m.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} {v.baseModel ? `· ${v.baseModel}` : ""}
                  </option>
                ))}
              </select>
            </div>

            {version && version.trainedWords.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-muted)]">Trigger words</label>
                <div className="flex flex-wrap gap-1">
                  {version.trainedWords.map((w) => (
                    <span
                      key={w}
                      onClick={() => navigator.clipboard?.writeText(w)}
                      className="cursor-pointer rounded bg-[var(--color-ink)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-amber)] hover:bg-[var(--color-line)]"
                      title="Copy"
                    >
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {m.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {m.tags.slice(0, 12).map((t) => (
                  <span key={t} className="rounded-full bg-[var(--color-elevated)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {description && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-muted)]">About</label>
                <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-muted)]">
                  {description}
                </p>
              </div>
            )}

            {file && (
              <p className="text-[11px] text-[var(--color-faint)]">
                {file.name} · {(file.sizeKB / 1024).toFixed(0)} MB{file.format ? ` · ${file.format}` : ""}
              </p>
            )}
          </div>

          {/* Download */}
          <div className="border-t border-[var(--color-line)] px-5 py-4">
            <button
              onClick={download}
              disabled={status === "downloading" || status === "completed" || !file}
              className={cn(
                "relative flex h-10 w-full items-center justify-center gap-2 overflow-hidden rounded-[var(--radius-sm)] text-sm font-medium transition-opacity disabled:opacity-100",
                status === "completed"
                  ? "bg-[var(--color-good)]/15 text-[var(--color-good)]"
                  : "bg-[var(--color-amber)] text-[var(--color-on-amber)] hover:opacity-90",
              )}
            >
              {status === "downloading" && (
                <span className="absolute inset-y-0 left-0 bg-black/20" style={{ width: `${pct}%` }} />
              )}
              <span className="relative flex items-center gap-2">
                {status === "downloading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Downloading… {pct}%
                  </>
                ) : status === "completed" ? (
                  <>
                    <Check className="h-4 w-4" /> Installed
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" /> Download{file ? ` · ${(file.sizeKB / 1024).toFixed(0)} MB` : ""}
                  </>
                )}
              </span>
            </button>
            {status === "failed" && (
              <p className="mt-2 text-[11px] text-[var(--color-danger)]">{job?.error ?? "Download failed"}</p>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Flatten Civitai's HTML description into readable plain text. */
function htmlToText(html?: string): string {
  if (!html) return "";
  return html
    .replace(/<\/(p|div|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
