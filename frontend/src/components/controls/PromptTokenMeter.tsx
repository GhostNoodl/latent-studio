import { useMemo } from "react";
import { chunkStats, hasBreak, CHUNK_LIMIT } from "@/lib/tokenCount";
import { parseInlineRegions } from "@latent/shared";

/**
 * Token-count readout for a prompt field. Without BREAK: a single total.
 * With BREAK: one `~n/75` figure per chunk, amber when a chunk would exceed
 * CLIP's 75-token window and spill. Counts are estimates (see tokenCount.ts).
 */
export function PromptTokenMeter({ value }: { value: string }) {
  const stats = useMemo(() => chunkStats(value), [value]);
  const inline = useMemo(() => parseInlineRegions(value), [value]);
  if (!value.trim()) return null;

  if (inline.regions.length > 0 && inline.errors.length === 0) {
    const tracks = [
      { label: "global", stats: chunkStats(inline.basePrompt) },
      ...inline.regions.map((region, index) => ({ label: `R${index + 1}`, stats: chunkStats(region.prompt) })),
    ].filter((track) => track.stats.chunks.length > 0);
    return <div className="mt-1 flex flex-wrap justify-end gap-x-2 font-mono text-[10px] text-[var(--color-faint)]" title="Estimated tokens per regional conditioning"><>{tracks.map((track) => <span key={track.label} className={track.stats.chunks.some((count) => count > CHUNK_LIMIT) ? "text-[var(--color-amber)]" : undefined}>{track.label} ~{track.stats.total}</span>)}</></div>;
  }

  const multi = hasBreak(value) && stats.chunks.length > 1;
  return (
    <div
      className="mt-1 flex justify-end font-mono text-[10px] text-[var(--color-faint)]"
      title="Estimated CLIP tokens per chunk (CLIP encodes in 75-token windows; BREAK starts a new window)"
    >
      {multi ? (
        stats.chunks.map((n, i) => (
          <span key={i}>
            {i > 0 && <span className="mx-1.5">·</span>}
            <span className={n > CHUNK_LIMIT ? "text-[var(--color-amber)]" : undefined}>
              ~{n}/{CHUNK_LIMIT}
            </span>
          </span>
        ))
      ) : (
        <span>~{stats.total} tokens</span>
      )}
    </div>
  );
}
