import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X, Layers, Dices, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SeedMode } from "@/lib/genStore";
import type { ParamValue, WorkflowManifest } from "@latent/shared";

interface AxisState {
  key: string;
  /** Comma-separated values for numeric params. */
  raw: string;
  /** Selected options for enum params. */
  picks: string[];
}

const EMPTY_AXIS: AxisState = { key: "", raw: "", picks: [] };
const MAX_RUNS = 256;

/**
 * Batch builder: sweep one or two parameters and/or run a list of prompts,
 * producing one queued generation per combination.
 */
export function BatchBuilder({
  manifest,
  values,
  onQueue,
  onClose,
}: {
  manifest: WorkflowManifest;
  values: Record<string, ParamValue>;
  onQueue: (runs: Record<string, ParamValue>[], seedMode: SeedMode) => void | Promise<void>;
  onClose: () => void;
}) {
  const posKey = manifest.params.find((p) => p.control === "textarea" && /pos/i.test(p.label))?.key;
  const eligible = useMemo(
    () => manifest.params.filter((p) => ["slider", "number", "select"].includes(p.control)),
    [manifest],
  );

  const [axis1, setAxis1] = useState<AxisState>(EMPTY_AXIS);
  const [axis2, setAxis2] = useState<AxisState>(EMPTY_AXIS);
  const [prompts, setPrompts] = useState("");
  const [sameSeed, setSameSeed] = useState(true);
  const [busy, setBusy] = useState(false);

  const specFor = (key: string) => eligible.find((p) => p.key === key);

  function axisValues(axis: AxisState): { key: string; value: ParamValue }[] {
    const spec = specFor(axis.key);
    if (!spec) return [];
    if (spec.control === "select") return axis.picks.map((v) => ({ key: axis.key, value: v }));
    // numeric — parse the comma list into finite numbers
    return axis.raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))
      .map((value) => ({ key: axis.key, value }));
  }

  const promptLines = prompts
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const runs = useMemo(() => {
    const a1 = axisValues(axis1);
    const a2 = axisValues(axis2);
    const dim1 = a1.length ? a1 : [null];
    const dim2 = a2.length ? a2 : [null];
    const dimP = promptLines.length && posKey ? promptLines : [null];
    const out: Record<string, ParamValue>[] = [];
    for (const v1 of dim1)
      for (const v2 of dim2)
        for (const p of dimP) {
          const o: Record<string, ParamValue> = {};
          if (v1) o[v1.key] = v1.value;
          if (v2) o[v2.key] = v2.value;
          if (p != null && posKey) o[posKey] = p;
          out.push(o);
        }
    // Only meaningful if at least one axis/prompt varies something.
    return out.some((o) => Object.keys(o).length > 0) ? out : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis1, axis2, prompts, posKey]);

  const overflow = runs.length > MAX_RUNS;
  const queueable = runs.length > 0 && !overflow;

  async function queue() {
    if (!queueable) return;
    setBusy(true);
    try {
      await onQueue(runs, sameSeed ? "fixed" : "random");
    } finally {
      setBusy(false); // stays usable if the parent kept the modal open on error
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
        initial={{ scale: 0.97, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[var(--color-amber)]" />
            <h2 className="font-display text-sm font-semibold">Batch builder</h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Axis
            title="Vary a parameter"
            axis={axis1}
            setAxis={setAxis1}
            eligible={eligible}
            disabledKey={axis2.key}
          />
          <Axis
            title="And a second (optional — makes a grid)"
            axis={axis2}
            setAxis={setAxis2}
            eligible={eligible}
            disabledKey={axis1.key}
          />

          {/* Prompt list */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-muted)]">
              Prompt list <span className="text-[var(--color-faint)]">(one per line, optional)</span>
            </label>
            <textarea
              value={prompts}
              onChange={(e) => setPrompts(e.target.value)}
              rows={4}
              placeholder={posKey ? "a red fox in snow\na blue fox at night\n…" : "No positive-prompt field on this pipeline"}
              disabled={!posKey}
              className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)] disabled:opacity-50"
            />
            {promptLines.length > 0 && (
              <p className="text-[11px] text-[var(--color-faint)]">{promptLines.length} prompts</p>
            )}
          </div>

          {/* Seed handling */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-muted)]">Seed</label>
            <div className="flex gap-2">
              <SeedChoice active={sameSeed} onClick={() => setSameSeed(true)} icon={<Lock className="h-3.5 w-3.5" />}>
                Same seed
              </SeedChoice>
              <SeedChoice active={!sameSeed} onClick={() => setSameSeed(false)} icon={<Dices className="h-3.5 w-3.5" />}>
                Random each
              </SeedChoice>
            </div>
            <p className="text-[11px] text-[var(--color-faint)]">
              {sameSeed
                ? "Locks the seed so only the swept setting changes — best for comparisons."
                : "Rolls a new seed per run — more variety, less controlled."}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-5 py-3.5">
          <span className={cn("text-xs", overflow ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]")}>
            {overflow
              ? `${runs.length} runs — over the ${MAX_RUNS} limit`
              : runs.length > 0
                ? `${runs.length} run${runs.length > 1 ? "s" : ""} will queue`
                : "Pick a parameter or add prompts"}
          </span>
          <button
            onClick={queue}
            disabled={!queueable || busy}
            className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" />
            {busy ? "Queuing…" : `Queue ${runs.length || ""}`.trim()}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Axis({
  title,
  axis,
  setAxis,
  eligible,
  disabledKey,
}: {
  title: string;
  axis: AxisState;
  setAxis: (a: AxisState) => void;
  eligible: WorkflowManifest["params"];
  disabledKey?: string;
}) {
  const spec = eligible.find((p) => p.key === axis.key);
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--color-muted)]">{title}</label>
      <select
        value={axis.key}
        onChange={(e) => setAxis({ ...EMPTY_AXIS, key: e.target.value })}
        className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2 text-sm outline-none focus:border-[var(--color-amber)]"
      >
        <option value="">— none —</option>
        {eligible.map((p) => (
          <option key={p.key} value={p.key} disabled={p.key === disabledKey}>
            {p.label}
            {p.group === "advanced" ? "  (advanced)" : ""}
          </option>
        ))}
      </select>

      {spec && spec.control === "select" && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {(spec.options ?? []).map((opt) => {
            const on = axis.picks.includes(opt);
            return (
              <button
                key={opt}
                onClick={() =>
                  setAxis({
                    ...axis,
                    picks: on ? axis.picks.filter((o) => o !== opt) : [...axis.picks, opt],
                  })
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  on
                    ? "border-[var(--color-amber)] bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
                    : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {spec && spec.control !== "select" && (
        <input
          value={axis.raw}
          onChange={(e) => setAxis({ ...axis, raw: e.target.value })}
          placeholder="values, comma-separated — e.g. 3, 5, 7"
          className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 font-mono text-sm outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)]"
        />
      )}
    </div>
  );
}

function SeedChoice({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-2 text-xs transition-colors",
        active
          ? "border-[var(--color-amber)] bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
          : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
