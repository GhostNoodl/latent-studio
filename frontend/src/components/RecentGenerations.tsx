import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Check } from "lucide-react";
import { api } from "@/lib/api";
import type { ParamValue } from "@latent/shared";

/**
 * A slim strip of this pipeline's recent generations under the result area. Clicking one
 * reuses its exact settings (prompt + params) so you can riff off a past image without
 * hunting through the gallery.
 */
export function RecentGenerations({
  pipelineId,
  onReuse,
}: {
  pipelineId: string;
  onReuse: (params: Record<string, ParamValue>) => void;
}) {
  const { data = [] } = useQuery({
    queryKey: ["generations", "recent", pipelineId],
    queryFn: () => api.generations({ pipelineId, limit: 24 }),
    refetchInterval: 10_000,
  });
  const [reused, setReused] = useState<string | null>(null);

  const done = data.filter((r) => r.status === "completed" && r.outputs.length > 0);
  if (done.length === 0) return null;

  function reuse(id: string, params: Record<string, ParamValue>) {
    onReuse(params);
    setReused(id);
    setTimeout(() => setReused((v) => (v === id ? null : v)), 1500);
  }

  return (
    <div className="shrink-0 border-t border-[var(--color-line)] bg-[var(--color-ink)]/40 px-4 py-2.5">
      <div className="mx-auto flex max-w-[1100px] items-center gap-3">
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
          <History className="h-3.5 w-3.5" /> Recent
        </div>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
          {done.map((r) => {
            const src = r.thumbnail ?? r.outputs[0]?.url;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => reuse(r.id, r.params)}
                title="Reuse these settings"
                className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-line)] transition-colors hover:border-[var(--color-amber)]"
              >
                {src ? (
                  <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-[var(--color-surface)]" />
                )}
                <div className="absolute inset-0 grid place-items-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                  {reused === r.id ? (
                    <Check className="h-4 w-4 text-[var(--color-good)]" />
                  ) : (
                    <span className="text-[9px] font-semibold text-white">Reuse</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
