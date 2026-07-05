import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Download, Loader2, Check, Compass } from "lucide-react";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";
import { cn } from "@/lib/utils";
import type { WorkflowManifest, ParamValue, StarterModelState } from "@latent/shared";

const base = (f: string) => f.split(/[\\/]/).pop() ?? f;

type Missing = { label: string; kind: string; file: string; starter?: StarterModelState };

/**
 * Pre-flight guard for the Generate screen: if the pipeline references model files
 * that aren't installed (common when onboarding was skipped), surface them up-front
 * with one-click downloads — instead of a cryptic ComfyUI failure at run time.
 */
export function MissingModelsBanner({
  manifest,
  values,
}: {
  manifest: WorkflowManifest;
  values: Record<string, ParamValue>;
}) {
  const { data: installed = [] } = useQuery({ queryKey: ["models", "all"], queryFn: () => api.models("all") });
  const { data: starters = [] } = useQuery({ queryKey: ["starter-models"], queryFn: api.starterModels });

  const missing = useMemo<Missing[]>(() => {
    const have = new Set(installed.map((m) => base(m.file)));
    const seen = new Set<string>();
    const out: Missing[] = [];
    for (const p of manifest.params) {
      if (!p.modelKind || p.control === "loras") continue; // LoRAs are optional/user-added
      const file = String(values[p.key] ?? p.default ?? "").trim();
      if (!file || file === "None") continue;
      const b = base(file);
      if (seen.has(b)) continue;
      seen.add(b);
      if (have.has(b)) continue;
      // A checkpoint is interchangeable — if the user has ANY, the pipeline can run,
      // so don't nag about the specific one the workflow happened to be saved with.
      if (p.modelKind === "checkpoint" && installed.some((m) => m.kind === "checkpoint")) continue;
      out.push({ label: p.label, kind: p.modelKind, file: b, starter: starters.find((s) => base(s.filename) === b) });
    }
    return out;
  }, [manifest, values, installed, starters]);

  if (!missing.length) return null;

  return (
    <div className="border-b border-[var(--color-amber)]/30 bg-[var(--color-amber)]/10 px-5 py-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-amber)]" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-[var(--color-text)]">
            This pipeline needs {missing.length} model{missing.length === 1 ? "" : "s"} you don't have yet — grab them so it can run.
          </div>
          <div className="mt-2 space-y-1">
            {missing.map((m) => (
              <MissingRow key={m.file} item={m} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MissingRow({ item }: { item: Missing }) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const job = useWs((s) => (jobId ? s.downloads[jobId] : undefined));
  const s = item.starter;
  const status = job?.status;
  const pct = job && job.total ? Math.round((job.received / job.total) * 100) : 0;

  // When the download finishes, refresh the catalog so this row (and the banner) clears.
  useEffect(() => {
    if (status === "completed") {
      qc.invalidateQueries({ queryKey: ["models"] });
      qc.invalidateQueries({ queryKey: ["starter-models"] });
    }
  }, [status, qc]);

  async function get() {
    if (!s) return;
    setBusy(true);
    try {
      const j =
        s.source.type === "civitai"
          ? await api.startDownload(s.source.modelId, s.source.versionId)
          : await api.startUrlDownload({
              url: s.source.url,
              folder: s.folder,
              filename: s.filename,
              kind: s.kind,
              name: s.label,
              sizeBytes: s.sizeBytes,
              headers: s.source.headers,
            });
      setJobId(j.id);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="truncate font-mono text-[var(--color-muted)]">{item.file}</span>
      <span className="shrink-0 text-[var(--color-faint)]">· {item.kind}</span>
      <div className="ml-auto shrink-0">
        {status === "completed" ? (
          <span className="inline-flex items-center gap-1 text-[var(--color-good)]">
            <Check className="h-3 w-3" /> Installed
          </span>
        ) : s ? (
          <button
            onClick={get}
            disabled={busy || status === "downloading"}
            className={cn(
              "inline-flex h-6 min-w-[3.5rem] items-center justify-center gap-1 rounded-[var(--radius-sm)] px-2 font-medium transition-colors",
              "bg-[var(--color-amber)] text-[var(--color-on-amber)] hover:opacity-90 disabled:opacity-80",
            )}
          >
            {status === "downloading" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> {pct}%
              </>
            ) : (
              <>
                <Download className="h-3 w-3" /> Get
              </>
            )}
          </button>
        ) : (
          <Link
            to="/discover"
            className="inline-flex items-center gap-1 text-[var(--color-amber)] hover:underline"
          >
            <Compass className="h-3 w-3" /> Find in Discover
          </Link>
        )}
      </div>
    </div>
  );
}
