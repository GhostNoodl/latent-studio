import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Server, Workflow, Boxes, Check, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useTour } from "@/lib/tour";
import { SetupPanel } from "@/components/SetupPanel";
import { StarterModelsGrid } from "@/components/onboarding/StarterModelsGrid";
import { cn } from "@/lib/utils";

type Step = "welcome" | "engine" | "pipelines" | "models" | "done";
const STEPS: Step[] = ["welcome", "engine", "pipelines", "models", "done"];

/** First-run onboarding: welcome → ComfyUI → pipelines → models → tour. Shows until completed. */
export function OnboardingWizard() {
  const queryClient = useQueryClient();
  const startTour = useTour((s) => s.start);
  const { data: onboarding } = useQuery({ queryKey: ["onboarding"], queryFn: api.onboarding });
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: (q) => (q.state.data && q.state.data.comfyui !== "ok" ? 2500 : 10_000),
  });
  const [step, setStep] = useState<Step>("welcome");
  const [finishing, setFinishing] = useState(false);

  const comfyOk = health?.comfyui === "ok";
  // Don't render until we know the flag; hide once onboarded.
  if (!onboarding || onboarding.onboardedAt) return null;

  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)] ?? "done");
  const back = () => setStep(STEPS[Math.max(idx - 1, 0)] ?? "welcome");

  async function finish() {
    setFinishing(true);
    await api.completeOnboarding().catch(() => {});
    await queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    startTour(); // kick off the interactive tour
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
          initial={{ scale: 0.97, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.97, y: 10 }}
        >
          {/* Header + step dots */}
          <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-5 py-4">
            <div className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] bg-gradient-to-br from-[var(--color-amber)] to-[var(--color-violet)]">
              <Sparkles className="h-4 w-4 text-[var(--color-on-amber)]" />
            </div>
            <span className="font-display text-base font-semibold">Welcome to Latent</span>
            <div className="ml-auto flex gap-1.5">
              {STEPS.map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-colors",
                    i <= idx ? "bg-[var(--color-amber)]" : "bg-[var(--color-line-strong)]",
                  )}
                />
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {step === "welcome" && (
              <Panel icon={Sparkles} title="Your own ComfyUI studio">
                <p>
                  Latent is a clean front‑end for ComfyUI — it runs its own engine, keeps your models
                  organized, and gives every setting a proper control. This quick setup gets you a
                  working ComfyUI, a couple of ready‑made pipelines, and the models to run them.
                </p>
                <p className="text-[var(--color-faint)]">Takes a minute. You can skip any step.</p>
              </Panel>
            )}

            {step === "engine" && (
              <Panel icon={Server} title="ComfyUI engine">
                {comfyOk ? (
                  <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-good)]/30 bg-[var(--color-good)]/10 px-3 py-2 text-sm text-[var(--color-good)]">
                    <Check className="h-4 w-4" /> ComfyUI is ready.
                  </div>
                ) : (
                  <>
                    <p>Latent needs a ComfyUI backend. It can install its own — bundled Python + torch, nothing else to set up.</p>
                    <div className="mt-3">
                      <SetupPanel gate />
                    </div>
                  </>
                )}
              </Panel>
            )}

            {step === "pipelines" && <PipelinesStep comfyOk={comfyOk} />}

            {step === "models" && (
              <Panel icon={Boxes} title="Suggested models">
                <p className="mb-3">
                  Pick a checkpoint by the look you want (★ = recommended) — each is ~6.5&nbsp;GB, so
                  grab one to start. The <b>Support &amp; extras</b> (VAE, upscaler, detailers) are what
                  the pipelines actually need. You can add more anytime in Discover.
                </p>
                <StarterModelsGrid />
              </Panel>
            )}

            {step === "done" && (
              <Panel icon={Check} title="You're all set">
                <p>
                  That's it. Downloads keep running in the background (watch them in the bottom‑left
                  bell). Next up: a quick tour of the app.
                </p>
              </Panel>
            )}
          </div>

          {/* Footer nav */}
          <div className="flex items-center justify-between border-t border-[var(--color-line)] px-5 py-3">
            <button
              onClick={back}
              disabled={idx === 0}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
            {step === "done" ? (
              <button
                onClick={finish}
                disabled={finishing}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90"
              >
                {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Finish & tour
              </button>
            ) : (
              <div className="flex items-center gap-3">
                {(step === "engine" || step === "models") && (
                  <button onClick={next} className="text-xs text-[var(--color-faint)] hover:text-[var(--color-muted)]">
                    Skip
                  </button>
                )}
                <button
                  onClick={next}
                  disabled={step === "engine" && !comfyOk}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
        <Icon className="h-4 w-4 text-[var(--color-amber)]" /> {title}
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--color-muted)]">{children}</div>
    </div>
  );
}

/** Seeds the bundled pipelines on enter (needs ComfyUI up) and reports the result. */
function PipelinesStep({ comfyOk }: { comfyOk: boolean }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "seeding" | "done">("idle");
  const { data: pipelines = [] } = useQuery({ queryKey: ["pipelines"], queryFn: api.pipelines });

  useEffect(() => {
    if (!comfyOk || state !== "idle") return;
    setState("seeding");
    api
      .seedPipelines()
      .catch(() => {})
      .finally(async () => {
        await queryClient.invalidateQueries({ queryKey: ["pipelines"] });
        setState("done");
      });
  }, [comfyOk, state, queryClient]);

  return (
    <Panel icon={Workflow} title="Pipelines">
      {!comfyOk ? (
        <p className="text-[var(--color-faint)]">Waiting for ComfyUI…</p>
      ) : state === "seeding" ? (
        <p className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Setting up the default pipelines…
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-good)]/30 bg-[var(--color-good)]/10 px-3 py-2 text-sm text-[var(--color-good)]">
            <Check className="h-4 w-4" /> {pipelines.length} pipeline{pipelines.length === 1 ? "" : "s"} ready.
          </div>
          <ul className="mt-2 space-y-1 text-[13px]">
            {pipelines.map((p) => (
              <li key={p.id} className="text-[var(--color-muted)]">
                • {p.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
