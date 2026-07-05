import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Sparkles, Square, Layers, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useGen } from "@/lib/genStore";
import { usePrefs } from "@/lib/prefs";
import { useWs } from "@/lib/ws";
import { buildEffectiveWorkflow } from "@/lib/workflow";
import { ParamField } from "@/components/controls/ParamField";
import { PresetBar } from "@/components/PresetBar";
import { PipelineTabs } from "@/components/PipelineTabs";
import { MissingModelsBanner } from "@/components/MissingModelsBanner";
import { AdvancedParams } from "@/components/controls/AdvancedParams";
import { RawEditor } from "@/components/controls/RawEditor";
import { ResultCanvas } from "@/components/ResultCanvas";
import { BatchBuilder } from "@/components/BatchBuilder";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComfyWorkflow, ParamSpec, ParamValue } from "@latent/shared";
import { isParamVisible } from "@latent/shared";

type View = "simple" | "advanced" | "raw";

export function PipelinePage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { data: manifest, isLoading } = useQuery({
    queryKey: ["pipelines", id],
    queryFn: () => api.pipeline(id),
  });

  const { hydrate, setValue, values, seedMode, setSeedMode, batch, setBatch } = useGen();
  // Installed checkpoints — used to default the pipeline to one that actually exists.
  const { data: installedCkpts = [] } = useQuery({
    queryKey: ["models", "checkpoint"],
    queryFn: () => api.models("checkpoint"),
    staleTime: 60_000,
  });
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const showBatchBuilder = usePrefs((s) => s.showBatchBuilder);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get("view") as View) ?? "simple";
  const [rawText, setRawText] = useState("");
  const rawSeededFor = useRef<string | null>(null);
  const queueRemaining = useWs((s) => s.queueRemaining);
  const live = useWs((s) => s.live);
  const generating = queueRemaining > 0 || Object.keys(live).length > 0;

  // Definitive stop: drop anything pending, then interrupt the running prompt.
  const stopAll = async () => {
    await api.clearQueue().catch(() => {});
    await api.interrupt().catch(() => {});
  };

  // Re-derive the control panel from the workflow (picks up new/relabelled controls
  // like the hires-fix rescale method) without losing current values.
  const [rebuilding, setRebuilding] = useState(false);
  const rebuildControls = async () => {
    if (!manifest) return;
    setRebuilding(true);
    try {
      await api.rebuildPipeline(manifest.id);
      await queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    } finally {
      setRebuilding(false);
    }
  };

  useEffect(() => {
    if (manifest) hydrate(manifest);
  }, [manifest, hydrate]);

  // The seeded default checkpoint may name a model this machine doesn't have. Any
  // checkpoint runs the pipeline, so once we know what's installed, default to an
  // installed one (preferring one that's in the picker) instead of a missing file.
  useEffect(() => {
    if (!manifest || !installedCkpts.length) return;
    const ckpt = manifest.params.find((p) => p.modelKind === "checkpoint");
    if (!ckpt) return;
    const base = (f: string) => f.split(/[\\/]/).pop() ?? f;
    const have = new Set(installedCkpts.map((m) => base(m.file)));
    const cur = base(String(values(manifest.id)[ckpt.key] ?? "").trim());
    if (have.has(cur)) return; // current pick is installed — leave it
    const opts = new Set((ckpt.options ?? []).map(base));
    const pick = installedCkpts.find((m) => opts.has(base(m.file))) ?? installedCkpts[0]!;
    setValue(manifest.id, ckpt.key, pick.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest?.id, installedCkpts]);

  // Seed the raw editor when entering raw view — and RE-seed when the pipeline
  // changes (tabs keep this page mounted), so we never submit a stale graph.
  useEffect(() => {
    if (view === "raw" && manifest && rawSeededFor.current !== manifest.id) {
      setRawText(JSON.stringify(buildEffectiveWorkflow(manifest, values(manifest.id)), null, 2));
      rawSeededFor.current = manifest.id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, manifest]);

  const simpleParams = useMemo(
    () => manifest?.params.filter((p) => p.group === "simple") ?? [],
    [manifest],
  );
  // Base prompts go in the wide main area; feature-gated prompts (e.g. per-region
  // prompts, hidden until their toggle is on) group into the left panel instead.
  const promptParams = useMemo(
    () => simpleParams.filter((p) => p.control === "textarea" && !p.visibleWhen),
    [simpleParams],
  );
  const groups = useMemo(
    () => groupSettings(simpleParams.filter((p) => p.control !== "textarea" || Boolean(p.visibleWhen))),
    [simpleParams],
  );

  if (isLoading) return <div className="p-8 text-sm text-[var(--color-muted)]">Loading…</div>;
  if (!manifest)
    return (
      <div className="p-8">
        <p className="text-sm text-[var(--color-muted)]">Pipeline not found.</p>
        <Link to="/generate" className="mt-3 inline-block text-sm text-[var(--color-amber)]">
          ← Back
        </Link>
      </div>
    );

  const current = values(manifest.id);
  // Hide feature params (ControlNet, hires) whose toggle is off; drop now-empty groups.
  const visibleGroups = groups
    .map((g) => ({ ...g, params: g.params.filter((p) => isParamVisible(p, current)) }))
    .filter((g) => g.params.length > 0);
  // Blank-canvas size for source-less region masks — the pipeline's dimensions if it
  // exposes them, else a square default (masks resize to the latent anyway).
  const wSpec = simpleParams.find((p) => p.input === "width");
  const hSpec = simpleParams.find((p) => p.input === "height");
  const dw = wSpec ? Number(current[wSpec.key]) : 0;
  const dh = hSpec ? Number(current[hSpec.key]) : 0;
  const blankSize = dw > 0 && dh > 0 ? { w: dw, h: dh } : { w: 1024, h: 1024 };

  // Appending a LoRA's trigger words to the positive prompt (works wherever the
  // prompt field is rendered).
  const appendTriggers = (words: string) => {
    const posKey = manifest.params.find(
      (p) => p.control === "textarea" && /pos/i.test(p.label),
    )?.key;
    if (!posKey) return;
    const cur = String(current[posKey] ?? "").trim();
    if (cur.includes(words)) return;
    setValue(manifest.id, posKey, cur ? `${cur}, ${words}` : words);
  };

  function switchView(next: View) {
    // Seed the raw editor from the current effective workflow when entering raw.
    if (next === "raw" && manifest) {
      setRawText(JSON.stringify(buildEffectiveWorkflow(manifest, current), null, 2));
      rawSeededFor.current = manifest.id;
    }
    const params = new URLSearchParams(searchParams);
    if (next === "simple") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
  }

  async function onGenerate() {
    if (!manifest) return;
    let rawWorkflow: ComfyWorkflow | undefined;
    if (view === "raw") {
      try {
        rawWorkflow = JSON.parse(rawText);
      } catch {
        return; // invalid JSON — editor already flags it
      }
    }
    setSubmitting(true);
    try {
      const { generationIds } = await api.generate({
        pipelineId: manifest.id,
        values: current,
        rawWorkflow,
        seedMode,
        batch,
      });
      setSessionIds((prev) => [...generationIds, ...prev]);
      queryClient.invalidateQueries({ queryKey: ["generations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function onQueueBatch(runs: Record<string, ParamValue>[], mode: typeof seedMode) {
    if (!manifest) return;
    setSubmitting(true);
    try {
      const { generationIds } = await api.generate({
        pipelineId: manifest.id,
        values: current,
        runs,
        seedMode: mode,
      });
      setSessionIds((prev) => [...generationIds, ...prev]);
      queryClient.invalidateQueries({ queryKey: ["generations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      setBatchOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PipelineTabs activeId={manifest.id} />
      <MissingModelsBanner manifest={manifest} values={current} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Param panel */}
        <div className="flex w-full flex-col border-b border-[var(--color-line)] md:h-full md:w-[384px] md:shrink-0 md:border-b-0 md:border-r lg:w-[460px]">

        {/* Simple / Advanced / Raw */}
        <div className="flex items-center gap-2 px-5 pt-4">
          <div className="flex flex-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-strong)]">
            {(["simple", "advanced", "raw"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => switchView(v)}
                className={cn(
                  "flex-1 px-2 py-1.5 text-[11px] uppercase tracking-wide transition-colors",
                  view === v
                    ? "bg-[var(--color-elevated)] text-[var(--color-text)]"
                    : "text-[var(--color-faint)] hover:text-[var(--color-muted)]",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={rebuildControls}
            disabled={rebuilding}
            title="Refresh controls — re-read this workflow's parameters from ComfyUI (keeps your current values)"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] text-[var(--color-faint)] transition-colors hover:text-[var(--color-amber)] disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", rebuilding && "animate-spin")} />
          </button>
        </div>

        {view === "simple" && (
          <PresetBar
            manifest={manifest}
            values={current}
            onSet={(key, val) => setValue(manifest.id, key, val)}
          />
        )}

        <div className="space-y-4 px-4 py-3 md:flex-1 md:overflow-y-auto">
          {view === "simple" &&
            visibleGroups.map((g) => (
              <div key={g.title} className="space-y-2">
                <div className="border-b border-[var(--color-line)] pb-1 text-[10px] font-medium uppercase tracking-widest text-[var(--color-faint)]">
                  {g.title}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-2.5">
                  {g.params.map((spec) => (
                    <div
                      key={spec.key}
                      className={isWideField(spec) ? "w-full" : "w-[calc(50%-0.375rem)] min-w-0"}
                    >
                      <ParamField
                        spec={spec}
                        value={current[spec.key] ?? ""}
                        onChange={(val) => setValue(manifest.id, spec.key, val)}
                        onLoraTriggers={appendTriggers}
                        allValues={current}
                        blankSize={blankSize}
                        maskSource={
                          spec.control === "mask" && spec.paintTarget
                            ? comfyInputUrl(current[spec.paintTarget])
                            : undefined
                        }
                        maskSourceName={
                          spec.control === "mask" && spec.paintTarget
                            ? (String(current[spec.paintTarget] ?? "") || undefined)
                            : undefined
                        }
                      />
                      {/* Seed mode lives right under the Seed field. */}
                      {spec.control === "seed" && (
                        <div className="mt-2 space-y-1">
                          <SeedModeToggle mode={seedMode} onChange={setSeedMode} />
                          <p className="text-[11px] text-[var(--color-faint)]">
                            {seedMode === "random"
                              ? "A fresh random seed each run (the field above is ignored)."
                              : seedMode === "increment"
                                ? "Starts from the seed above, +1 each run."
                                : "Reuses the exact seed above every run."}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          {view === "advanced" && (
            <AdvancedParams
              manifest={manifest}
              values={current}
              onChange={(key, val) => setValue(manifest.id, key, val)}
            />
          )}
          {view === "raw" && (
            <p className="text-xs leading-relaxed text-[var(--color-muted)]">
              Editing the raw ComfyUI workflow in the canvas. On Generate it's submitted
              verbatim — the ultimate override.
            </p>
          )}
        </div>

        {/* Generate bar */}
        <div className="space-y-3 border-t border-[var(--color-line)] px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Runs</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--color-muted)]">×</span>
              <input
                type="number"
                min={1}
                max={64}
                value={batch}
                onChange={(e) => setBatch(Number(e.target.value))}
                className="h-8 w-14 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2 text-center font-mono text-xs"
              />
            </div>
          </div>
          {view !== "raw" && showBatchBuilder && (
            <button
              onClick={() => setBatchOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] py-2 text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-amber)] hover:text-[var(--color-text)]"
            >
              <Layers className="h-3.5 w-3.5" /> Batch builder — sweeps &amp; prompt lists
            </button>
          )}
          <Button variant="primary" size="lg" className="w-full" onClick={onGenerate} disabled={submitting}>
            <Sparkles className="h-4 w-4" />
            {submitting ? "Queuing…" : batch > 1 ? `Generate ${batch}` : "Generate"}
          </Button>
          {generating && (
            <button
              onClick={stopAll}
              className="flex w-full items-center justify-center gap-1.5 text-[11px] text-[var(--color-faint)] hover:text-[var(--color-danger)]"
            >
              <Square className="h-3 w-3" /> Interrupt{queueRemaining > 0 ? ` (${queueRemaining} queued)` : ""}
            </button>
          )}
        </div>
      </div>

      {/* Main area: prompts (wide) + results, or the raw editor */}
      <div className="flex min-h-[55vh] min-w-0 flex-1 flex-col md:h-full md:overflow-hidden">
        {view === "raw" ? (
          <div className="h-[70vh] md:h-full">
            <RawEditor value={rawText} onChange={setRawText} />
          </div>
        ) : (
          <>
            {view === "simple" && promptParams.length > 0 && (
              <div className="shrink-0 border-b border-[var(--color-line)] px-5 py-4 md:px-6">
                <div className="mx-auto grid max-w-[1100px] gap-4 lg:grid-cols-2">
                  {promptParams.map((spec) => (
                    <ParamField
                      key={spec.key}
                      spec={spec}
                      value={current[spec.key] ?? ""}
                      onChange={(val) => setValue(manifest.id, spec.key, val)}
                      onLoraTriggers={appendTriggers}
                      textareaRows={5}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ResultCanvas
                sessionIds={sessionIds}
                pipelineType={manifest.type}
                onSpawn={(gid) => setSessionIds((prev) => [gid, ...prev])}
              />
            </div>
          </>
        )}
      </div>
      </div>

      <AnimatePresence>
        {batchOpen && (
          <BatchBuilder
            manifest={manifest}
            values={current}
            onQueue={onQueueBatch}
            onClose={() => setBatchOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const GROUP_ORDER = ["Model & Inputs", "Dimensions", "Sampling", "Regional", "ControlNet", "Hires Fix", "Face Detailer", "Other"] as const;
type GroupTitle = (typeof GROUP_ORDER)[number];

/** Classify a setting into a friendly section so the panel reads cleanly. */
/** URL to view a ComfyUI input image (an uploaded source), for the mask backdrop. */
function comfyInputUrl(value: ParamValue | undefined): string | undefined {
  const v = String(value ?? "").trim();
  if (!v) return undefined;
  const slash = v.lastIndexOf("/");
  const name = slash >= 0 ? v.slice(slash + 1) : v;
  const qs = new URLSearchParams({ name });
  if (slash >= 0) qs.set("subfolder", v.slice(0, slash));
  return `/api/comfy-input?${qs.toString()}`;
}

function settingGroup(spec: ParamSpec): GroupTitle {
  if (spec.section === "ControlNet") return "ControlNet"; // keep the CN controls together
  if (spec.section === "Regional") return "Regional"; // keep the region controls together
  if (spec.section === "Face Detailer") return "Face Detailer"; // its own on/off panel
  const l = spec.label.toLowerCase();
  const i = spec.input;
  if (spec.modelKind === "upscale" || i === "percent" || i.startsWith("rescale") || /hires|upscal|rescale/.test(l))
    return "Hires Fix";
  if (spec.modelKind || spec.control === "loras" || spec.control === "image" || spec.control === "mask")
    return "Model & Inputs";
  if (i === "width" || i === "height" || i === "batch_size" || /\b(width|height|resolution|size|batch)\b/.test(l))
    return "Dimensions";
  if (/seed|step|cfg|sampler|schedul|denoise|fps|second|headroom|refiner|guidance|noise/.test(l))
    return "Sampling";
  return "Other";
}

function groupSettings(params: ParamSpec[]): { title: GroupTitle; params: ParamSpec[] }[] {
  const map = new Map<GroupTitle, ParamSpec[]>();
  for (const p of params) {
    const g = settingGroup(p);
    const arr = map.get(g) ?? [];
    arr.push(p);
    map.set(g, arr);
  }
  return GROUP_ORDER.filter((t) => map.has(t)).map((title) => ({ title, params: map.get(title)! }));
}

/** Pickers / LoRAs / image / seed span the row; short numerics pack two-up. */
function isWideField(spec: ParamSpec): boolean {
  return (
    Boolean(spec.modelKind) ||
    Boolean(spec.cnPreview) ||
    spec.control === "loras" ||
    spec.control === "image" ||
    spec.control === "mask" ||
    spec.control === "seed" ||
    spec.control === "textarea" // gated region prompts render full-width in their group
  );
}

function SeedModeToggle({
  mode,
  onChange,
}: {
  mode: "fixed" | "random" | "increment";
  onChange: (m: "fixed" | "random" | "increment") => void;
}) {
  const modes: ("fixed" | "random" | "increment")[] = ["random", "fixed", "increment"];
  return (
    <div className="flex flex-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-strong)]">
      {modes.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={
            "flex-1 px-2 py-1.5 text-[10px] uppercase tracking-wide transition-colors " +
            (mode === m
              ? "bg-[var(--color-elevated)] text-[var(--color-text)]"
              : "text-[var(--color-faint)] hover:text-[var(--color-muted)]")
          }
        >
          {m === "increment" ? "incr" : m}
        </button>
      ))}
    </div>
  );
}
