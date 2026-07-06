import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Sparkles, Scaling, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { useWs, type LiveState } from "@/lib/ws";
import { Mono } from "@/components/ui/primitives";
import { Lightbox } from "@/components/Lightbox";
import { seedFingerprint } from "@/lib/utils";
import type { GenerationRecord, PipelineType } from "@latent/shared";

export function ResultCanvas({
  sessionIds,
  pipelineType,
  onSpawn,
}: {
  sessionIds: string[];
  pipelineType: PipelineType;
  /** Push a follow-up generation (e.g. an upscale) into this session's canvas. */
  onSpawn?: (id: string) => void;
}) {
  const live = useWs((s) => s.live);
  const { data: records = [] } = useQuery({
    queryKey: ["generations"],
    queryFn: () => api.generations({ limit: 200 }),
  });

  const [zoom, setZoom] = useState<{ url: string; filename?: string } | null>(null);

  const byId = new Map(records.map((r) => [r.id, r]));
  const items = sessionIds.map((id) => ({ id, record: byId.get(id), live: live[id] }));

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="latent-grain grid h-24 w-24 place-items-center rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-surface)]">
          <Sparkles className="h-7 w-7 text-[var(--color-amber)]" strokeWidth={1.25} />
        </div>
        <div>
          <p className="font-display text-lg">Ready when you are</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Set your parameters and hit Generate — results resolve here.
          </p>
        </div>
      </div>
    );
  }

  const [hero, ...rest] = items;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-6">
      {hero && (
        <Tile {...hero} pipelineType={pipelineType} onSpawn={onSpawn} onOpen={setZoom} hero />
      )}
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rest.map((it) => (
            <Tile key={it.id} {...it} pipelineType={pipelineType} onSpawn={onSpawn} onOpen={setZoom} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {zoom && (
          <Lightbox src={zoom.url} filename={zoom.filename} onClose={() => setZoom(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function Tile({
  record,
  live,
  pipelineType,
  onSpawn,
  onOpen,
  hero = false,
}: {
  id: string;
  record?: GenerationRecord;
  live?: LiveState;
  pipelineType: PipelineType;
  onSpawn?: (id: string) => void;
  onOpen?: (v: { url: string; filename?: string }) => void;
  hero?: boolean;
}) {
  const queryClient = useQueryClient();
  const [upscaling, setUpscaling] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const running = !record || record.status === "queued" || record.status === "running";
  const failed = record?.status === "failed";
  const output = record?.outputs[0];
  const isImage = !running && !!output && pipelineType !== "video";
  const canUpscale = !running && !failed && !!output && pipelineType !== "video";

  async function upscale() {
    if (!record) return;
    setUpscaling(true);
    try {
      const { generationId } = await api.upscale(record.id);
      onSpawn?.(generationId);
      queryClient.invalidateQueries({ queryKey: ["generations"] });
    } catch (err) {
      console.error(err);
    } finally {
      setUpscaling(false);
    }
  }

  async function enhance() {
    if (!record) return;
    setEnhancing(true);
    try {
      const { generationId } = await api.enhance(record.id);
      onSpawn?.(generationId);
      queryClient.invalidateQueries({ queryKey: ["generations"] });
    } catch (err) {
      console.error(err);
    } finally {
      setEnhancing(false);
    }
  }

  return (
    <figure
      className={
        "group relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] " +
        (hero ? "mx-auto max-w-3xl" : "")
      }
    >
      <div
        className={
          "relative flex items-center justify-center bg-[var(--color-ink)] " +
          (hero ? "min-h-[300px]" : "aspect-square")
        }
      >
        {/* Finished output */}
        {!running && output && pipelineType === "video" && (
          <video
            src={output.url}
            controls
            loop
            className={
              "animate-resolve object-contain " +
              (hero ? "max-h-[56vh] w-auto max-w-full" : "h-full w-full")
            }
          />
        )}
        {isImage && output && (
          <img
            src={output.url}
            alt=""
            onClick={() => onOpen?.({ url: output.url, filename: output.filename })}
            className={
              "cursor-zoom-in animate-resolve object-contain " +
              (hero ? "max-h-[56vh] w-auto max-w-full" : "h-full w-full")
            }
          />
        )}

        {/* Enhance / Upscale — inline follow-ups, stream back into this canvas */}
        {canUpscale && (
          <div className="absolute right-2 top-2 flex gap-1.5 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            <button
              type="button"
              onClick={enhance}
              disabled={enhancing || upscaling}
              title="Upscale 2× and refine detail (fixes eyes / microdetail)"
              className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-amber)]/40 bg-black/55 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm transition-opacity hover:bg-black/75 disabled:opacity-70"
            >
              <Wand2 className="h-3.5 w-3.5 text-[var(--color-amber)]" />
              {enhancing ? "Enhancing…" : "Enhance"}
            </button>
            <button
              type="button"
              onClick={upscale}
              disabled={upscaling || enhancing}
              title="Quick ESRGAN upscale (no refine)"
              className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-white/15 bg-black/55 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm transition-opacity hover:bg-black/75 disabled:opacity-70"
            >
              <Scaling className="h-3.5 w-3.5" />
              {upscaling ? "Upscaling…" : "Upscale"}
            </button>
          </div>
        )}

        {/* Live preview while running */}
        {running && (
          <div className="latent-grain absolute inset-0 grid place-items-center">
            {live?.preview ? (
              <img src={live.preview} alt="preview" className="h-full w-full object-contain opacity-90" />
            ) : (
              <div className="text-center">
                <div className="font-mono text-xs text-[var(--color-faint)]">
                  {live?.node ? "rendering" : "queued"}
                </div>
              </div>
            )}
          </div>
        )}

        {failed && (
          <div className="absolute inset-0 grid place-items-center p-4 text-center">
            <p className="text-xs text-[var(--color-danger)]">{record?.error ?? "Failed"}</p>
          </div>
        )}

        {/* Progress bar */}
        {running && live && live.max > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-[var(--color-elevated)]">
            <div
              className="h-full bg-gradient-to-r from-[var(--color-amber)] to-[var(--color-violet)] transition-all"
              style={{ width: `${Math.round((live.value / live.max) * 100)}%` }}
            />
          </div>
        )}
      </div>

      <figcaption className="flex items-center justify-between px-3 py-2">
        <Mono className="text-[10px]">{seedFingerprint(record?.seed)}</Mono>
        <span className="text-[10px] text-[var(--color-faint)]">
          {running ? (live?.max ? `${live.value}/${live.max}` : "…") : record?.status}
        </span>
      </figcaption>
    </figure>
  );
}
