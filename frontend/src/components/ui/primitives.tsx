import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "amber" | "violet" | "good" | "danger";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-[var(--color-line-strong)] text-[var(--color-muted)]",
    amber: "border-[var(--color-amber)]/40 text-[var(--color-amber)]",
    violet: "border-[var(--color-violet)]/40 text-[var(--color-violet)]",
    good: "border-[var(--color-good)]/40 text-[var(--color-good)]",
    danger: "border-[var(--color-danger)]/40 text-[var(--color-danger)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: "good" | "danger" | "muted" }) {
  const colors = {
    good: "var(--color-good)",
    danger: "var(--color-danger)",
    muted: "var(--color-faint)",
  };
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: colors[tone], boxShadow: `0 0 8px ${colors[tone]}` }}
    />
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[var(--color-muted)]", className)}>{children}</span>;
}
