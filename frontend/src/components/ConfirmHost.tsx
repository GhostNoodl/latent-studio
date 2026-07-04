import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useConfirmStore } from "@/lib/confirm";
import { cn } from "@/lib/utils";

/** Renders the app-wide styled confirmation dialog. Mount once (in Layout). */
export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    useConfirmStore.setState({ pending: null });
  };

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => close(false)}
        >
          <motion.div
            className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-2xl"
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              {pending.danger && (
                <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-danger)]/15">
                  <AlertTriangle className="h-4 w-4 text-[var(--color-danger)]" />
                </div>
              )}
              <div className="min-w-0">
                <h2 className="font-display text-sm font-semibold text-[var(--color-text)]">{pending.title}</h2>
                {pending.body && (
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">{pending.body}</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
              >
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                autoFocus
                onClick={() => close(true)}
                className={cn(
                  "rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90",
                  pending.danger
                    ? "bg-[var(--color-danger)] text-white"
                    : "bg-[var(--color-amber)] text-[var(--color-on-amber)]",
                )}
              >
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
