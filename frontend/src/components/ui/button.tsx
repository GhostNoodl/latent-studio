import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-sm font-medium transition-colors focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-amber)] text-[var(--color-on-amber)] hover:bg-[color-mix(in_oklab,var(--color-amber)_88%,white)] font-semibold",
        violet:
          "bg-[var(--color-violet)] text-[var(--color-on-violet)] hover:bg-[color-mix(in_oklab,var(--color-violet)_88%,white)] font-semibold",
        outline:
          "border border-[var(--color-line-strong)] bg-transparent text-[var(--color-text)] hover:bg-[var(--color-elevated)]",
        ghost: "bg-transparent text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]",
        subtle: "bg-[var(--color-elevated)] text-[var(--color-text)] hover:bg-[color-mix(in_oklab,var(--color-elevated)_70%,var(--color-line-strong))]",
        danger: "bg-transparent border border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "subtle", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
