import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-4 border-b border-[var(--color-line)] px-5 py-5 md:px-8 md:py-6">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
          {eyebrow}
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}
