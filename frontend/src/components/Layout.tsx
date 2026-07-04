import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Images, SlidersHorizontal, Boxes, Compass, PanelLeftClose, PanelLeftOpen, Terminal } from "lucide-react";
import { api } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { Dot } from "@/components/ui/primitives";
import { QueueIndicator } from "@/components/QueueIndicator";
import { NotificationCenter } from "@/components/NotificationCenter";
import { SetupGate } from "@/components/SetupGate";
import { ConfirmHost } from "@/components/ConfirmHost";
import { PromptHost } from "@/components/PromptHost";
import { Console, useConsole } from "@/components/Console";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { Tour } from "@/components/Tour";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/generate", label: "Generate", icon: Sparkles },
  { to: "/gallery", label: "Gallery", icon: Images },
  { to: "/models", label: "Models", icon: Boxes },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal },
];

export function Layout({ children }: { children: ReactNode }) {
  const collapsed = usePrefs((s) => s.sidebarCollapsed);
  const toggle = usePrefs((s) => s.toggleSidebar);
  return (
    <div className="flex h-full w-full">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>

      {/* Floating expand button — only when collapsed, desktop only. */}
      <AnimatePresence>
        {collapsed && (
          <motion.button
            key="expand-sidebar"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            onClick={toggle}
            title="Show sidebar"
            className="fixed left-3 top-3.5 z-40 hidden h-9 w-9 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]/90 text-[var(--color-muted)] shadow-lg backdrop-blur transition-colors hover:text-[var(--color-text)] md:grid"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>

      <MobileNav />
      <QueueIndicator />
      <NotificationCenter />
      <SetupGate />
      <ConfirmHost />
      <PromptHost />
      <Console />
      <OnboardingWizard />
      <Tour />
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] bg-gradient-to-br from-[var(--color-amber)] to-[var(--color-violet)]">
        <span className="text-sm font-bold text-[var(--color-on-amber)]">L</span>
      </div>
      <div className="leading-tight">
        <div className="font-display text-[15px] font-semibold tracking-tight">Latent</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
          ComfyUI Studio
        </div>
      </div>
    </div>
  );
}

function useComfyOk() {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 8000,
  });
  return health?.comfyui === "ok";
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 0 : 240 }}
      transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
      className="hidden shrink-0 overflow-hidden bg-[var(--color-surface)] md:block"
    >
      <div className="flex h-full w-60 flex-col border-r border-[var(--color-line)]">
        <div className="flex items-center justify-between px-5 py-5">
          <Brand />
          <button
            onClick={onToggle}
            title="Hide sidebar"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--color-faint)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex flex-col gap-1 px-3 py-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              data-tour={`nav-${label.toLowerCase()}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-[var(--color-elevated)] text-[var(--color-text)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-elevated)]/60 hover:text-[var(--color-text)]",
                )
              }
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}

          <ConsoleButton />
        </nav>
      </div>
    </motion.aside>
  );
}

function ConsoleButton() {
  const toggle = useConsole((s) => s.toggle);
  return (
    <button
      onClick={toggle}
      data-tour="nav-console"
      className="mt-1 flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-elevated)]/60 hover:text-[var(--color-text)]"
    >
      <Terminal className="h-4 w-4" strokeWidth={1.75} />
      Console
    </button>
  );
}

function MobileTopBar() {
  const comfyOk = useComfyOk();
  const toggleConsole = useConsole((s) => s.toggle);
  return (
    <header className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 md:hidden">
      <Brand />
      <div className="flex items-center gap-3">
        <button onClick={toggleConsole} title="Console" className="text-[var(--color-muted)]">
          <Terminal className="h-4 w-4" />
        </button>
        <Dot tone={comfyOk ? "good" : "danger"} />
      </div>
    </header>
  );
}

function MobileNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--color-line)] bg-[var(--color-surface)] md:hidden">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px]",
              isActive ? "text-[var(--color-amber)]" : "text-[var(--color-muted)]",
            )
          }
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
