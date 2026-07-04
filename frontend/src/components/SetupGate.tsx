import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";
import { useLogs } from "@/lib/logs";
import { SetupPanel } from "@/components/SetupPanel";

/**
 * Startup gate:
 *  - While Latent-launched ComfyUI is still booting → a "Starting ComfyUI…" screen
 *    (with a live status line + "Launch anyway"), so we never dump the user into a
 *    half-working UI or a misleading "download ComfyUI" prompt.
 *  - When no ComfyUI is reachable and none is managed → the first-run setup prompt.
 * Both are dismissible so a temporarily-down external ComfyUI can't trap anyone.
 */
export function SetupGate() {
  const live = useWs((s) => s.setup);
  const { data: status } = useQuery({
    queryKey: ["setup-status"],
    queryFn: api.setupStatus,
    refetchInterval: 15_000,
  });
  // Poll health quickly while ComfyUI is down (so the gate lifts the moment it
  // answers), then back off once it's up.
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: (q) => (q.state.data && q.state.data.comfyui !== "ok" ? 2500 : 10_000),
  });
  // While first-run onboarding is active, the wizard owns the ComfyUI-setup UI —
  // don't stack a second gate on top of it.
  const { data: onboarding } = useQuery({ queryKey: ["onboarding"], queryFn: api.onboarding });
  const setup = live ?? status;
  const lastComfyLog = useLogs((s) => {
    for (let i = s.items.length - 1; i >= 0; i--) if (s.items[i]!.source === "comfy") return s.items[i]!.text;
    return "";
  });
  const [dismissed, setDismissed] = useState(false);
  const onboardingActive = onboarding != null && !onboarding.onboardedAt;

  const busy =
    setup?.phase === "downloading" ||
    setup?.phase === "extracting" ||
    setup?.phase === "launching" ||
    setup?.phase === "installing-nodes";

  const reachable = health?.comfyui === "ok";
  const starting = !!health?.comfyStarting && !busy;
  const needsSetup = !reachable && !starting && !busy && setup != null && !setup.managedInstalled;

  const show = !onboardingActive && (busy || (!dismissed && (starting || needsSetup)));
  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-2xl"
          initial={{ scale: 0.97, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.97, y: 10 }}
        >
          {starting ? (
            // ── ComfyUI is booting ──────────────────────────────────────────────
            <>
              <div className="mb-1 flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] bg-gradient-to-br from-[var(--color-amber)] to-[var(--color-violet)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--color-on-amber)]" />
                </div>
                <h2 className="font-display text-base font-semibold">Starting ComfyUI…</h2>
              </div>
              <p className="mb-3 text-xs text-[var(--color-muted)]">
                Latent is booting ComfyUI. This can take a minute on the first run while it loads
                models &amp; custom nodes. The app will open automatically when it's ready.
              </p>
              <div className="mb-4 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2">
                <div className="truncate font-mono text-[11px] text-[var(--color-faint)]">
                  {lastComfyLog || "Warming up…"}
                </div>
              </div>
              <button
                onClick={() => setDismissed(true)}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] py-2 text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-amber)] hover:text-[var(--color-text)]"
              >
                Launch anyway
              </button>
            </>
          ) : (
            // ── No ComfyUI available → first-run setup ─────────────────────────
            <>
              <div className="mb-1 flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] bg-gradient-to-br from-[var(--color-amber)] to-[var(--color-violet)]">
                  <Sparkles className="h-4 w-4 text-[var(--color-on-amber)]" />
                </div>
                <h2 className="font-display text-base font-semibold">Set up ComfyUI</h2>
              </div>
              <p className="mb-4 text-xs text-[var(--color-muted)]">
                Latent needs a ComfyUI backend. It can install its own — the official portable bundles
                everything (embedded Python + torch), so there's nothing else to set up.
              </p>

              <SetupPanel gate />

              {!busy && (
                <button
                  onClick={() => setDismissed(true)}
                  className="mt-4 w-full text-center text-[11px] text-[var(--color-faint)] hover:text-[var(--color-muted)]"
                >
                  I have ComfyUI elsewhere — continue anyway
                </button>
              )}
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
