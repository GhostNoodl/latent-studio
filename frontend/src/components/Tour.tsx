import { useEffect, useLayoutEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTour, TOUR_STEPS } from "@/lib/tour";

/** Interactive spotlight tour: highlights a `data-tour` element and explains it. */
export function Tour() {
  const active = useTour((s) => s.active);
  const index = useTour((s) => s.index);
  const next = useTour((s) => s.next);
  const prev = useTour((s) => s.prev);
  const stop = useTour((s) => s.stop);
  const step = TOUR_STEPS[index];
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Measure the target element (re-measure on step change, resize, scroll).
  useLayoutEffect(() => {
    if (!active || !step) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, index, step]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, next, prev, stop]);

  if (!active || !step) return null;

  // Tooltip sits to the right of the target (or centered if we couldn't find it).
  const pad = 8;
  const tipStyle: React.CSSProperties = rect
    ? { top: Math.max(12, rect.top), left: rect.right + 16 }
    : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[85]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={stop}
      >
        {/* Spotlight: transparent box over the target, huge shadow darkens the rest. */}
        {rect ? (
          <div
            className="pointer-events-none absolute rounded-[var(--radius-md)] ring-2 ring-[var(--color-amber)]"
            style={{
              top: rect.top - pad,
              left: rect.left - pad,
              width: rect.width + pad * 2,
              height: rect.height + pad * 2,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-black/72" />
        )}

        {/* Tooltip */}
        <motion.div
          key={index}
          className="absolute w-72 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-2xl"
          style={tipStyle}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 font-display text-sm font-semibold text-[var(--color-text)]">{step.title}</div>
          <p className="text-xs leading-relaxed text-[var(--color-muted)]">{step.body}</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-[var(--color-faint)]">
              {index + 1} / {TOUR_STEPS.length}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={stop} className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-muted)]">
                Skip
              </button>
              <button
                onClick={next}
                className="rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90"
              >
                {index === TOUR_STEPS.length - 1 ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
