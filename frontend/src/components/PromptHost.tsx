import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePromptStore } from "@/lib/prompt-dialog";

/** App-wide styled text-input dialog (replaces window.prompt). Mount once in Layout. */
export function PromptHost() {
  const pending = usePromptStore((s) => s.pending);
  const [value, setValue] = useState("");

  // Seed the field each time a new prompt opens.
  useEffect(() => setValue(pending?.defaultValue ?? ""), [pending]);

  const close = (result: string | null) => {
    pending?.resolve(result);
    usePromptStore.setState({ pending: null });
  };
  const submit = () => {
    const v = value.trim();
    close(v ? v : null);
  };

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => close(null)}
        >
          <motion.div
            className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-2xl"
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-sm font-semibold text-[var(--color-text)]">{pending.title}</h2>
            {pending.body && (
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">{pending.body}</p>
            )}
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  close(null);
                }
              }}
              placeholder={pending.placeholder}
              className="mt-3 h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => close(null)}
                className="rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
              >
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                onClick={submit}
                disabled={!value.trim()}
                className="rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {pending.confirmLabel ?? "Save"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
