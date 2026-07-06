import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useLogs } from "@/lib/logs";
import { cn } from "@/lib/utils";

/**
 * Full-screen boot cover shown on launch until the whole studio is actually ready —
 * ComfyUI online, its object catalog loaded, pipelines prepared — so we reveal a working
 * UI, not a half-loaded one behind a modal. Shows each stage as it lands (transparency)
 * plus the live ComfyUI log. Defers to onboarding (first run) and to SetupGate (when
 * ComfyUI genuinely needs installing). Fades out when ready; skippable if it stalls.
 */
export function BootScreen() {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: (q) => (q.state.data?.comfyui === "ok" ? 4000 : 1200),
  });
  const { data: pipelines } = useQuery({
    queryKey: ["pipelines"],
    queryFn: api.pipelines,
    refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? false : 1500),
  });
  const { data: onboarding } = useQuery({ queryKey: ["onboarding"], queryFn: api.onboarding });
  const { data: setup } = useQuery({ queryKey: ["setup-status"], queryFn: api.setupStatus, refetchInterval: 8000 });
  const lastComfyLog = useLogs((s) => {
    for (let i = s.items.length - 1; i >= 0; i--) if (s.items[i]!.source === "comfy") return s.items[i]!.text;
    return "";
  });

  const [skipped, setSkipped] = useState(false);
  const [showSkip, setShowSkip] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 12_000);
    return () => clearTimeout(t);
  }, []);

  const onboardingActive = onboarding != null && !onboarding.onboardedAt;
  const reachable = health?.comfyui === "ok";
  const modelsReady = !!health?.objectInfoCached;
  const pipelinesReady = (pipelines?.length ?? 0) > 0;
  const ready = reachable && modelsReady && pipelinesReady;
  // ComfyUI genuinely absent (not booting, none managed) → SetupGate owns that screen.
  const needsSetup = health != null && !reachable && !health.comfyStarting && !setup?.managedInstalled;

  const show = !skipped && !onboardingActive && !needsSetup && !ready;

  const stages = [
    { label: "Backend", sub: "Latent server", done: health != null },
    { label: "ComfyUI engine", sub: reachable ? "online" : "starting up", done: reachable },
    { label: "Models & nodes", sub: "loading catalog", done: modelsReady },
    { label: "Pipelines", sub: "preparing controls", done: pipelinesReady },
  ];
  const doneCount = stages.filter((s) => s.done).length;
  const activeIdx = stages.findIndex((s) => !s.done);
  const logLine = !reachable ? lastComfyLog || "Warming up ComfyUI…" : ready ? "" : "Finishing up…";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[var(--color-ink)] px-6"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-9 flex flex-col items-center gap-3"
          >
            <div className="latent-grain grid h-16 w-16 place-items-center rounded-[var(--radius-xl)] bg-gradient-to-br from-[var(--color-amber)] to-[var(--color-violet)] shadow-lg">
              <span className="font-display text-2xl font-bold text-[var(--color-on-amber)]">L</span>
            </div>
            <div className="text-center">
              <div className="font-display text-xl font-semibold tracking-tight text-[var(--color-text)]">Latent</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">ComfyUI Studio</div>
            </div>
          </motion.div>

          <div className="w-full max-w-sm space-y-1.5">
            {stages.map((st, i) => {
              const active = i === activeIdx;
              return (
                <div
                  key={st.label}
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 transition-all duration-300",
                    st.done
                      ? "border-[var(--color-line)] bg-[var(--color-surface)]/40"
                      : active
                        ? "border-[var(--color-amber)]/40 bg-[var(--color-amber)]/[0.06]"
                        : "border-transparent opacity-40",
                  )}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center">
                    {st.done ? (
                      <Check className="h-4 w-4 text-[var(--color-good)]" strokeWidth={3} />
                    ) : active ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--color-amber)]" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-faint)]" />
                    )}
                  </span>
                  <div className={cn("flex-1 text-sm", st.done || active ? "text-[var(--color-text)]" : "text-[var(--color-muted)]")}>
                    {st.label}
                  </div>
                  <div className="font-mono text-[10px] text-[var(--color-faint)]">{st.done ? "ready" : active ? st.sub : ""}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 h-1 w-full max-w-sm overflow-hidden rounded-full bg-[var(--color-line)]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[var(--color-amber)] to-[var(--color-violet)]"
              animate={{ width: `${(doneCount / stages.length) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>

          <div className="mt-4 flex h-4 w-full max-w-sm items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={logLine}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="max-w-full truncate font-mono text-[11px] text-[var(--color-faint)]"
              >
                {logLine}
              </motion.div>
            </AnimatePresence>
          </div>

          {showSkip && (
            <button
              type="button"
              onClick={() => setSkipped(true)}
              className="mt-9 text-[11px] text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)]"
            >
              Taking a while? Skip to the app →
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
