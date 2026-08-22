import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { X, Heart, RefreshCw, SlidersHorizontal, Download, Trash2, Maximize2, ImagePlus, FolderPlus, Paintbrush } from "lucide-react";
import { api } from "@/lib/api";
import { useGen } from "@/lib/genStore";
import { SearchableSelect } from "@/components/controls/SearchableSelect";
import { AddToCollectionMenu } from "@/components/AddToCollectionMenu";
import { AudioPlayer } from "@/components/AudioPlayer";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/primitives";
import { seedFingerprint, formatRelative, cn } from "@/lib/utils";
import type { GenerationRecord } from "@latent/shared";

export function GenerationDetail({
  record,
  onClose,
}: {
  record: GenerationRecord;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setValueFor = useGen((s) => s.setValue);
  const applyValues = useGen((s) => s.applyValues);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [upscaler, setUpscaler] = useState("");
  const hasImageOutput = record.outputs.some((o) => o.type === "image");

  // Upscale models for the post-generation Upscale action.
  const { data: upscalers = [] } = useQuery({
    queryKey: ["models", "upscale"],
    queryFn: () => api.models("upscale"),
    enabled: hasImageOutput,
  });
  const upscalerOptions = upscalers.map((m) => m.file);

  // Manifest gives friendly labels for the stored param keys.
  const { data: manifest } = useQuery({
    queryKey: ["pipelines", record.pipelineId],
    queryFn: () => api.pipeline(record.pipelineId),
    retry: false,
  });
  // Albums this generation belongs to. The API keeps its legacy collection name
  // so existing installations and integrations remain compatible.
  const { data: memberIds = [] } = useQuery({
    queryKey: ["gen-collections", record.id],
    queryFn: () => api.collectionsFor(record.id),
  });

  // Pipelines that accept an image input — targets for "Use as input".
  const { data: pipelines = [] } = useQuery({ queryKey: ["pipelines"], queryFn: () => api.pipelines() });
  const inputTargets = useMemo(
    () =>
      pipelines.flatMap((p) =>
        p.params.filter((param) => param.control === "image").map((param) => ({ pipeline: p, param })),
      ),
    [pipelines],
  );
  const inpaintTarget = inputTargets.find(({ pipeline }) => pipeline.mode === "inpaint" || /inpaint/i.test(pipeline.name));
  const specFor = (key: string) => manifest?.params.find((p) => p.key === key);
  const labelFor = (key: string) => specFor(key)?.label ?? key;
  const baseName = (f: string) => f.split("/").pop()?.replace(/\.[^.]+$/, "").replace(/_/g, " ") ?? f;

  /** Friendly value: clean model names, summarized LoRAs, everything else as text. */
  function fmt(key: string, value: unknown): string {
    if (Array.isArray(value)) {
      const on = (value as { on: boolean; lora: string; strength: number }[]).filter((l) => l?.on);
      return on.length ? on.map((l) => `${baseName(String(l.lora))} ×${l.strength}`).join(", ") : "—";
    }
    if (specFor(key)?.modelKind) return baseName(String(value));
    return String(value);
  }

  const entries = Object.entries(record.params);
  const promptEntries = entries.filter(([k]) => specFor(k)?.control === "textarea");
  const simpleEntries = entries.filter(([k]) => {
    const s = specFor(k);
    return s ? s.group === "simple" && s.control !== "textarea" : true; // unknown → show by default
  });
  const advancedEntries = entries.filter(([k]) => specFor(k)?.group === "advanced");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["generations"] });
    queryClient.invalidateQueries({ queryKey: ["generation", record.id] });
  };

  async function toggleFavorite() {
    await api.setFavorite(record.id, !record.favorite);
    refresh();
  }
  async function remove() {
    await api.deleteGeneration(record.id);
    refresh();
    onClose();
  }

  async function upscale() {
    setBusy(true);
    try {
      await api.upscale(record.id, upscaler || undefined);
      refresh();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function reuseInWorkspace() {
    if (!manifest) return;
    setBusy(true);
    try {
      const reuse = await api.generationReuseSettings(record.id);
      applyValues(reuse.pipelineId, reuse.params);
      navigate(`/generate/${reuse.pipelineId}`);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function addToCollection(collectionId: string) {
    await api.addToCollection(collectionId, [record.id]);
    queryClient.invalidateQueries({ queryKey: ["gen-collections", record.id] });
    queryClient.invalidateQueries({ queryKey: ["collections"] });
  }

  async function useAsInput(pipelineId: string, paramKey: string) {
    setBusy(true);
    try {
      const { name } = await api.toInput(record.id);
      setValueFor(pipelineId, paramKey, name);
      onClose();
      navigate(`/generate/${pipelineId}`);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function quickEdit() {
    if (!inpaintTarget) return;
    setBusy(true);
    try {
      const { name } = await api.toInput(record.id);
      setValueFor(inpaintTarget.pipeline.id, inpaintTarget.param.key, name);
      onClose();
      navigate(`/generate/${inpaintTarget.pipeline.id}?quick=1`);
    } finally {
      setBusy(false);
    }
  }

  async function rerun(varySeed: boolean) {
    if (!manifest) return;
    setBusy(true);
    try {
      await api.generate({
        pipelineId: record.pipelineId,
        values: record.params,
        seedMode: varySeed ? "random" : "fixed",
        batch: 1,
      });
      refresh();
      onClose();
      navigate(`/generate/${record.pipelineId}`);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  const output = record.outputs[0];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
        <motion.div
          className="ml-auto flex h-full w-full max-w-5xl overflow-hidden bg-[var(--color-ink)] shadow-2xl"
          initial={{ x: 40 }}
          animate={{ x: 0 }}
          exit={{ x: 40 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Output stage */}
          <div className="hidden flex-1 items-center justify-center bg-black p-6 md:flex">
            {output &&
              (output.type === "video" ? (
                <video src={output.url} controls loop className="max-h-full max-w-full rounded-[var(--radius-md)]" />
              ) : output.type === "audio" ? (
                <AudioPlayer src={output.url} filename={output.filename} className="max-w-xl" />
              ) : (
                <img src={output.url} alt="" className="max-h-full max-w-full rounded-[var(--radius-md)] object-contain" />
              ))}
          </div>

          {/* Metadata panel */}
          <div className="flex w-full flex-col border-l border-[var(--color-line)] md:w-[380px]">
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
              <div>
                <div className="font-display text-sm font-semibold">{record.pipelineName}</div>
                <Mono className="text-[10px]">
                  {seedFingerprint(record.seed)} · {formatRelative(record.createdAt)}
                </Mono>
              </div>
              <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Mobile output */}
            {output && (
              <div className="bg-black p-3 md:hidden">
                {output.type === "video" ? (
                  <video src={output.url} controls playsInline className="max-h-72 w-full object-contain" />
                ) : output.type === "audio" ? (
                  <AudioPlayer src={output.url} filename={output.filename} />
                ) : (
                  <img src={output.url} alt="" className="max-h-72 w-full object-contain" />
                )}
              </div>
            )}

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {/* Prompts */}
              {promptEntries.map(([key, value]) => (
                <div key={key}>
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[var(--color-faint)]">
                    {labelFor(key)}
                  </div>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-ink)] p-2 text-xs leading-relaxed text-[var(--color-text)]">
                    {String(value) || "—"}
                  </p>
                </div>
              ))}

              {/* Key parameters */}
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-faint)]">
                  Parameters
                </div>
                <dl className="space-y-1.5">
                  {simpleEntries.map(([key, value]) => (
                    <ParamRow key={key} label={labelFor(key)} value={fmt(key, value)} />
                  ))}
                </dl>

                {advancedEntries.length > 0 && (
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className="mt-2 text-[11px] text-[var(--color-violet)] hover:underline"
                  >
                    {showAll ? "Hide advanced" : `Show everything (${advancedEntries.length} more)`}
                  </button>
                )}

                {showAll && (
                  <>
                    <dl className="mt-2 space-y-1.5 border-t border-[var(--color-line)] pt-2">
                      {advancedEntries.map(([key, value]) => (
                        <ParamRow key={key} label={labelFor(key)} value={fmt(key, value)} />
                      ))}
                    </dl>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-[var(--color-faint)]">
                        Raw parameters (JSON)
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-ink)] p-2 text-[10px] text-[var(--color-muted)]">
                        {JSON.stringify(record.params, null, 2)}
                      </pre>
                    </details>
                  </>
                )}
              </div>

              {record.performance && <PerformanceDetails performance={record.performance} />}
            </div>

            {/* Actions */}
            <div className="space-y-2 border-t border-[var(--color-line)] px-5 py-4">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="primary" onClick={() => rerun(true)} disabled={busy || !manifest}>
                  <RefreshCw className="h-4 w-4" /> Variations
                </Button>
                <Button variant="violet" onClick={() => rerun(false)} disabled={busy || !manifest}>
                  <RefreshCw className="h-4 w-4" /> Reproduce
                </Button>
              </div>
              {output?.type === "image" && (
                <div className="space-y-2">
                  {inpaintTarget && (
                    <Button variant="outline" className="w-full" onClick={quickEdit} disabled={busy}>
                      <Paintbrush className="h-4 w-4" /> Quick Edit
                    </Button>
                  )}
                  <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchableSelect
                      value={upscaler}
                      options={upscalerOptions}
                      onChange={setUpscaler}
                      placeholder="Auto upscaler"
                    />
                  </div>
                  <Button variant="subtle" onClick={upscale} disabled={busy}>
                    <Maximize2 className="h-4 w-4" /> Upscale
                  </Button>
                  </div>
                </div>
              )}
              {/* Organize + reuse */}
              <div className="flex items-center gap-2">
                {hasImageOutput && inputTargets.length > 0 && (
                  <div className="flex-1">
                    <UseAsInputMenu targets={inputTargets} disabled={busy} onPick={useAsInput} />
                  </div>
                )}
                <div className="flex-1">
                  <AddToCollectionMenu
                    onPick={addToCollection}
                    memberIds={memberIds}
                    trigger={(open) => (
                      <span
                        className={cn(
                          "flex h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-sm transition-colors",
                          open
                            ? "border-[var(--color-amber)] text-[var(--color-amber)]"
                            : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
                        )}
                      >
                        <FolderPlus className="h-3.5 w-3.5" /> Album
                      </span>
                    )}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={reuseInWorkspace} disabled={!manifest || busy}>
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Edit settings
                </Button>
                <Button
                  variant={record.favorite ? "primary" : "outline"}
                  size="icon"
                  onClick={toggleFavorite}
                  title="Favorite"
                >
                  <Heart className={cn("h-4 w-4", record.favorite && "fill-current")} />
                </Button>
                {output && (
                  <a href={output.url} download>
                    <Button variant="outline" size="icon" title="Download">
                      <Download className="h-4 w-4" />
                    </Button>
                  </a>
                )}
                <Button variant="danger" size="icon" onClick={remove} title="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {!manifest && (
                <p className="text-[11px] text-[var(--color-faint)]">
                  Source pipeline no longer exists — re-run unavailable.
                </p>
              )}
            </div>
          </div>
        </motion.div>
    </motion.div>
  );
}

interface InputTarget {
  pipeline: { id: string; name: string };
  param: { key: string; label: string };
}

/** "Use as input" — sends the output into a pipeline's image input. */
function UseAsInputMenu({
  targets,
  disabled,
  onPick,
}: {
  targets: InputTarget[];
  disabled?: boolean;
  onPick: (pipelineId: string, paramKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // A single target skips the menu entirely.
  const only = targets.length === 1 ? targets[0] : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (only ? onPick(only.pipeline.id, only.param.key) : setOpen((v) => !v))}
        className={cn(
          "flex h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-sm transition-colors disabled:opacity-50",
          open
            ? "border-[var(--color-amber)] text-[var(--color-amber)]"
            : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
        )}
        title="Send this image into a pipeline input"
      >
        <ImagePlus className="h-3.5 w-3.5" /> Use as input
      </button>
      {open && !only && (
        <div className="absolute bottom-full z-50 mb-2 w-full min-w-52 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] py-1 shadow-xl">
          {targets.map((t) => (
            <button
              key={`${t.pipeline.id}.${t.param.key}`}
              onClick={() => {
                onPick(t.pipeline.id, t.param.key);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-elevated)]"
            >
              <span className="truncate">{t.pipeline.name}</span>
              <span className="ml-1.5 text-xs text-[var(--color-faint)]">{t.param.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <dt className="shrink-0 text-[var(--color-muted)]">{label}</dt>
      <dd className="break-all text-right font-mono text-[var(--color-text)]">
        {value.length > 80 ? value.slice(0, 80) + "…" : value}
      </dd>
    </div>
  );
}

function PerformanceDetails({ performance }: { performance: NonNullable<GenerationRecord["performance"]> }) {
  const slowest = [...performance.nodes]
    .filter((node) => node.durationMs >= 1)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 6);
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-faint)]">
        Performance
      </div>
      <dl className="space-y-1.5">
        <ParamRow label="Total" value={formatDuration(performance.totalMs)} />
        {performance.queueMs !== undefined && <ParamRow label="Queue wait" value={formatDuration(performance.queueMs)} />}
        {performance.executionMs !== undefined && <ParamRow label="Comfy execution" value={formatDuration(performance.executionMs)} />}
        {performance.outputMs !== undefined && (
          <ParamRow
            label="Saving output"
            value={`${formatDuration(performance.outputMs)}${performance.outputMode ? ` · ${outputModeLabel(performance.outputMode)}` : ""}`}
          />
        )}
        {performance.cachedNodeCount > 0 && <ParamRow label="Cached nodes" value={String(performance.cachedNodeCount)} />}
      </dl>
      {slowest.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-[var(--color-violet)]">
            Slowest nodes
          </summary>
          <dl className="mt-2 space-y-1.5 border-t border-[var(--color-line)] pt-2">
            {slowest.map((node, index) => (
              <ParamRow
                key={`${node.nodeId}-${index}`}
                label={node.label || node.classType || `Node ${node.nodeId}`}
                value={formatDuration(node.durationMs)}
              />
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function outputModeLabel(mode: NonNullable<GenerationRecord["performance"]>["outputMode"]): string {
  return mode === "hardlink" ? "local link" : mode === "copy" ? "local copy" : mode === "http" ? "HTTP" : "mixed";
}
