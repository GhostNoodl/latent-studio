import { Link } from "react-router-dom";
import { Download, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function ModelLibraryTabs({ active }: { active: "installed" | "browse" }) {
  return (
    <div className="flex shrink-0 items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] p-0.5">
      <Tab to="/models" active={active === "installed"} icon={<Download className="h-3.5 w-3.5" />}>
        Installed
      </Tab>
      <Tab to="/models?tab=browse" active={active === "browse"} icon={<Search className="h-3.5 w-3.5" />}>
        Browse
      </Tab>
    </div>
  );
}

function Tab({ to, active, icon, children }: { to: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors",
        active
          ? "bg-[var(--color-elevated)] text-[var(--color-text)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
