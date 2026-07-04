import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  /** Renders a divider instead of an action when true. */
  separator?: boolean;
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  /** Shown right-aligned (e.g. a ✓ for membership). */
  trailing?: React.ReactNode;
}

/** A cursor-positioned right-click menu. Closes on action / outside / Esc / scroll. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Clamp within the viewport once measured.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      className="z-[60] min-w-48 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] py-1 shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 h-px bg-[var(--color-line)]" />
        ) : (
          <button
            key={i}
            onClick={() => {
              it.onClick?.();
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors",
              it.danger
                ? "text-[var(--color-muted)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
                : "text-[var(--color-text)] hover:bg-[var(--color-elevated)]",
            )}
          >
            {it.icon && <span className="shrink-0 text-[var(--color-faint)]">{it.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.trailing && <span className="shrink-0">{it.trailing}</span>}
          </button>
        ),
      )}
    </div>
  );
}
