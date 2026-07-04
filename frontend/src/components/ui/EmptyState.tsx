import type { LucideIcon } from "lucide-react";

/** Reusable guided empty-state: icon + title + hint + optional action. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid place-items-center gap-3 px-6 py-16 text-center ${className ?? ""}`}>
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-elevated)] text-[var(--color-faint)]">
        <Icon className="h-6 w-6" strokeWidth={1.25} />
      </div>
      <div>
        <div className="font-display text-sm font-semibold text-[var(--color-text)]">{title}</div>
        {hint && <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-[var(--color-muted)]">{hint}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
