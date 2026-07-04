import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Film, Plus, X } from "lucide-react";
import type { WorkflowManifest } from "@latent/shared";
import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { ImportPipelineDialog } from "@/components/ImportPipelineDialog";
import { cn } from "@/lib/utils";

const CUSTOM = "Custom";

/**
 * Two-level pipeline navigation: the top row picks a base family (e.g.
 * "Illustrious", "WAN 2.2"); the row below it picks a mode sub-tab within that
 * family (txt2img / img2img / inpaint / video). Imported workflows with no
 * grouping fall under a "Custom" family. Each pipeline is still its own id.
 */
export function PipelineTabs({ activeId }: { activeId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: pipelines = [] } = useQuery({ queryKey: ["pipelines"], queryFn: api.pipelines });
  const [importing, setImporting] = useState(false);

  // Group by base family (preserving the server's order), sub-sorted by `order`.
  const groups = useMemo(() => {
    const map = new Map<string, WorkflowManifest[]>();
    for (const p of pipelines) {
      const g = p.baseGroup ?? CUSTOM;
      (map.get(g) ?? map.set(g, []).get(g)!).push(p);
    }
    for (const list of map.values())
      list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
    return map;
  }, [pipelines]);

  const activeGroup = pipelines.find((p) => p.id === activeId)?.baseGroup ?? CUSTOM;
  const subTabs = groups.get(activeGroup) ?? [];

  function selectGroup(g: string) {
    if (g === activeGroup) return;
    const first = groups.get(g)?.[0];
    if (first) navigate(`/generate/${first.id}`);
  }

  async function remove(id: string, name: string) {
    if (
      !(await confirm({
        title: `Remove the “${name}” pipeline?`,
        body: "Your generations from it stay in the gallery.",
        danger: true,
        confirmLabel: "Remove",
      }))
    )
      return;
    await api.deletePipeline(id);
    queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    if (id === activeId) {
      const next = pipelines.find((p) => p.id !== id);
      navigate(next ? `/generate/${next.id}` : "/generate");
    }
  }

  return (
    <div className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
      {/* Base families */}
      <div className="flex items-center gap-1 overflow-x-auto px-3 pt-2">
        {[...groups.entries()].map(([group, list]) => {
          const active = group === activeGroup;
          const Icon = list.some((p) => p.type === "video") ? Film : ImageIcon;
          return (
            <button
              key={group}
              onClick={() => selectGroup(group)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-t-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-[var(--color-elevated)] text-[var(--color-text)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-elevated)]/50 hover:text-[var(--color-text)]",
              )}
            >
              <Icon className={cn("h-4 w-4", active && "text-[var(--color-amber)]")} strokeWidth={1.75} />
              {group}
            </button>
          );
        })}
        <button
          onClick={() => setImporting(true)}
          title="Import a workflow"
          className="ml-auto flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-elevated)]/50 hover:text-[var(--color-amber)]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Mode sub-tabs within the active family */}
      <div className="flex items-center gap-1 overflow-x-auto px-3 pb-2 pt-1.5">
        {subTabs.map((p) => {
          const active = p.id === activeId;
          return (
            <div
              key={p.id}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] pl-3 pr-2 py-1 text-[13px] transition-colors",
                active
                  ? "bg-[var(--color-amber)]/15 text-[var(--color-amber)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-elevated)]/50 hover:text-[var(--color-text)]",
              )}
              title={p.name}
            >
              <button onClick={() => navigate(`/generate/${p.id}`)} className="capitalize">
                {p.mode ?? p.name}
              </button>
              <button
                onClick={() => remove(p.id, p.name)}
                title="Remove pipeline"
                className="grid h-4 w-4 place-items-center rounded-full text-[var(--color-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {importing && <ImportPipelineDialog onClose={() => setImporting(false)} />}
      </AnimatePresence>
    </div>
  );
}
