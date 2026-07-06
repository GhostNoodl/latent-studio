import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { RefreshCw, Database, Plug, SlidersHorizontal, Palette, Check, KeyRound, Server, Power, Loader2, Sparkles, Braces } from "lucide-react";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";
import { useShutdown } from "@/lib/shutdown";
import { useTour } from "@/lib/tour";
import { usePrefs } from "@/lib/prefs";
import { THEMES } from "@/lib/theme";
import { PageHeader } from "@/components/PageHeader";
import { SetupPanel } from "@/components/SetupPanel";
import { WildcardsManager } from "@/components/WildcardsManager";
import { ModelDirectories } from "@/components/ModelDirectories";
import { VramMode } from "@/components/VramMode";
import { EnhanceFactor } from "@/components/EnhanceFactor";
import { Card, Badge, Dot } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const wsConnected = useWs((s) => s.connected);
  const showBatchBuilder = usePrefs((s) => s.showBatchBuilder);
  const setShowBatchBuilder = usePrefs((s) => s.setShowBatchBuilder);
  const themeId = usePrefs((s) => s.themeId);
  const customPrimary = usePrefs((s) => s.customPrimary);
  const setTheme = usePrefs((s) => s.setTheme);
  const setCustomPrimary = usePrefs((s) => s.setCustomPrimary);
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health });
  const { data: objectInfo, isFetching } = useQuery({
    queryKey: ["object-info"],
    queryFn: () => api.objectInfo(false),
    enabled: health?.comfyui === "ok",
  });

  const nodeCount = objectInfo ? Object.keys(objectInfo).length : 0;
  const comfyOk = health?.comfyui === "ok";
  const quitting = useShutdown((s) => s.quitting);
  const quit = useShutdown((s) => s.quit);
  const [wildcardsOpen, setWildcardsOpen] = useState(false);
  const { data: wildcardNames = [] } = useQuery({ queryKey: ["wildcards"], queryFn: api.wildcards });

  // Civitai API key
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [apiKey, setApiKey] = useState("");
  const [savedKey, setSavedKey] = useState(false);
  useEffect(() => {
    if (settings) setApiKey(settings.civitaiApiKey);
  }, [settings]);
  async function saveApiKey() {
    await api.saveSettings({ civitaiApiKey: apiKey.trim() });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    setSavedKey(true);
    setTimeout(() => setSavedKey(false), 1800);
  }

  return (
    <div>
      <PageHeader eyebrow="Configuration" title="Settings" />
      <div className="max-w-2xl space-y-5 p-8">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <Plug className="h-4 w-4 text-[var(--color-amber)]" />
            ComfyUI Connection
          </div>
          <Row label="Endpoint">
            <span className="font-mono text-xs text-[var(--color-text)]">
              {health?.comfyuiUrl ?? "—"}
            </span>
          </Row>
          <Row label="Status">
            <span className="flex items-center gap-2 text-xs">
              <Dot tone={comfyOk ? "good" : "danger"} />
              {comfyOk ? "Connected" : "Unreachable"}
            </span>
          </Row>
          <Row label="Live updates">
            <span className="flex items-center gap-2 text-xs">
              <Dot tone={wsConnected ? "good" : "muted"} />
              {wsConnected ? "Streaming" : "Disconnected"}
            </span>
          </Row>
          <Row label="Node catalog">
            <span className="flex items-center gap-2">
              <Badge tone={nodeCount > 0 ? "violet" : "neutral"}>
                <Database className="h-3 w-3" />
                {nodeCount > 0 ? `${nodeCount} node types` : "not loaded"}
              </Badge>
            </span>
          </Row>
          <div className="mt-4 flex items-center justify-between border-t border-[var(--color-line)] pt-4">
            <p className="max-w-xs text-xs text-[var(--color-muted)]">
              The node catalog (<span className="font-mono">/object_info</span>) powers every
              auto-generated control and the installed model lists.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!comfyOk || isFetching}
              onClick={async () => {
                await api.objectInfo(true);
                queryClient.invalidateQueries({ queryKey: ["object-info"] });
                queryClient.invalidateQueries({ queryKey: ["health"] });
              }}
            >
              <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              Refresh
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Server className="h-4 w-4 text-[var(--color-amber)]" />
            ComfyUI environment
          </div>
          <p className="mb-4 text-xs text-[var(--color-muted)]">
            Latent can install and run its own ComfyUI (official portable — embedded Python + torch,
            nothing else to install).
          </p>
          <SetupPanel />
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <Palette className="h-4 w-4 text-[var(--color-amber)]" />
            Appearance
          </div>
          <p className="mb-3 text-xs text-[var(--color-muted)]">Accent color — applies instantly across the app.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEMES.map((t) => (
              <ThemeSwatch
                key={t.id}
                name={t.name}
                primary={t.primary}
                secondary={t.secondary}
                active={themeId === t.id}
                onClick={() => setTheme(t.id)}
              />
            ))}
            {/* Custom accent */}
            <label
              className={cn(
                "relative flex cursor-pointer flex-col gap-2 rounded-[var(--radius-md)] border p-2.5 transition-colors",
                themeId === "custom"
                  ? "border-[var(--color-amber)] bg-[var(--color-elevated)]"
                  : "border-[var(--color-line-strong)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-elevated)]/50",
              )}
            >
              <div className="flex h-7 items-center gap-1.5">
                <span
                  className="h-5 w-5 rounded-full border border-white/10"
                  style={{ background: customPrimary }}
                />
                <span className="text-xs text-[var(--color-faint)]">pick</span>
                {themeId === "custom" && <Check className="ml-auto h-3.5 w-3.5 text-[var(--color-amber)]" />}
              </div>
              <span className="text-xs text-[var(--color-muted)]">Custom</span>
              <input
                type="color"
                value={customPrimary}
                onChange={(e) => setCustomPrimary(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Custom accent color"
              />
            </label>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4 text-[var(--color-amber)]" />
            Interface
          </div>
          <Row label="Batch builder">
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--color-muted)]">
                {showBatchBuilder ? "Shown" : "Hidden"}
              </span>
              <Toggle on={showBatchBuilder} onChange={setShowBatchBuilder} />
            </div>
          </Row>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Shows the parameter-sweep &amp; prompt-list builder on the generate screen.
          </p>
        </Card>

        <Card className="p-6">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Braces className="h-4 w-4 text-[var(--color-amber)]" />
            Prompt wildcards
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="max-w-sm text-xs text-[var(--color-muted)]">
              Reusable option lists. Type <span className="font-mono text-[var(--color-text)]">__name__</span>{" "}
              in any prompt to pull a random line — great for varying poses, outfits, or styles across a batch.
              {wildcardNames.length > 0 && (
                <span className="text-[var(--color-faint)]"> {wildcardNames.length} defined.</span>
              )}
            </p>
            <Button variant="outline" size="sm" onClick={() => setWildcardsOpen(true)}>
              <Braces className="h-3.5 w-3.5" />
              Manage
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4 text-[var(--color-amber)]" />
            Civitai API key
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your Civitai API key…"
              className="h-9 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 font-mono text-sm outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)]"
            />
            <Button variant="outline" size="sm" onClick={saveApiKey}>
              {savedKey ? <Check className="h-4 w-4 text-[var(--color-good)]" /> : "Save"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Optional. Needed to download login-gated models and increases rate limits. Create one under
            your Civitai <span className="font-mono">Account → API Keys</span>. Stored locally on this
            machine.
          </p>
        </Card>

        <ModelDirectories />

        <VramMode />

        <EnhanceFactor />

        {!comfyOk && (
          <Card className="border-[var(--color-danger)]/30 p-5 text-sm text-[var(--color-muted)]">
            Can't reach ComfyUI. Make sure it's running in Stability Matrix, then check{" "}
            <span className="font-mono text-[var(--color-text)]">COMFYUI_URL</span> in the backend{" "}
            <span className="font-mono">.env</span>.
          </Card>
        )}

        <Card className="p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-[var(--color-amber)]" />
            Getting started
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await api.resetOnboarding();
                queryClient.invalidateQueries({ queryKey: ["onboarding"] });
              }}
            >
              Run first-run setup again
            </Button>
            <Button variant="outline" size="sm" onClick={() => useTour.getState().start()}>
              Replay tour
            </Button>
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Re-open the welcome wizard (ComfyUI + suggested models) or replay the interactive tour.
          </p>
        </Card>

        <Card className="p-6">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Power className="h-4 w-4 text-[var(--color-amber)]" />
            Shut down
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="max-w-sm text-xs text-[var(--color-muted)]">
              Stops Latent and the ComfyUI it manages. You can also quit from the Console, close the
              last browser tab, or run <span className="font-mono">Stop Latent.cmd</span>.
            </p>
            <button
              onClick={quit}
              disabled={quitting}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-danger)]/40 px-3 py-2 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10 disabled:opacity-60"
            >
              {quitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
              {quitting ? "Stopping…" : "Quit Latent"}
            </button>
          </div>
        </Card>
      </div>

      <AnimatePresence>
        {wildcardsOpen && <WildcardsManager onClose={() => setWildcardsOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-line)]/60 py-2.5 last:border-0">
      <span className="text-sm text-[var(--color-muted)]">{label}</span>
      {children}
    </div>
  );
}

function ThemeSwatch({
  name,
  primary,
  secondary,
  active,
  onClick,
}: {
  name: string;
  primary: string;
  secondary: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-[var(--radius-md)] border p-2.5 text-left transition-colors",
        active
          ? "border-[var(--color-amber)] bg-[var(--color-elevated)]"
          : "border-[var(--color-line-strong)] hover:bg-[var(--color-elevated)]/50",
      )}
    >
      <div className="flex h-7 items-center gap-1.5">
        <span className="h-5 w-5 rounded-full border border-white/10" style={{ background: primary }} />
        <span className="h-5 w-5 rounded-full border border-white/10" style={{ background: secondary }} />
        {active && <Check className="ml-auto h-3.5 w-3.5 text-[var(--color-amber)]" />}
      </div>
      <span className="text-xs text-[var(--color-muted)]">{name}</span>
    </button>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex h-[24px] w-[44px] shrink-0 items-center rounded-full transition-colors",
        on ? "bg-[var(--color-amber)]" : "bg-[var(--color-elevated)]",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[22px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}
