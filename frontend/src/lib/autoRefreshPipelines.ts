import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";

/**
 * When a model download finishes, a pipeline's model dropdowns (checkpoint, VAE, …)
 * can be stale — their options are derived from ComfyUI's catalog at import time, and
 * onboarding seeds pipelines before any model is downloaded. Re-derive every pipeline
 * (debounced, so a burst of downloads triggers one refresh) so newly-installed models
 * show up as selectable options. Values are preserved; only the option lists refresh.
 */
export function useAutoRefreshPipelines(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useWs.getState().onDownload((job) => {
      // Rebuild on any completed download — some models (detectors, text encoders)
      // download as kind "other", so filtering by kind would miss them.
      if (job.status !== "completed") return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const pipes = await api.pipelines();
          await Promise.all(pipes.map((p) => api.rebuildPipeline(p.id).catch(() => {})));
          await qc.invalidateQueries({ queryKey: ["pipelines"] });
        } catch {
          /* best-effort — a stale dropdown is recoverable with the ↻ button */
        }
      }, 2500);
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [qc]);
}
