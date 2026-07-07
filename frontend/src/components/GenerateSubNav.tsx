import { useMemo, useState } from "react";
import { useNavigate, useMatch } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Film, Plus, X } from "lucide-react";
import type { WorkflowManifest } from "@latent/shared";
import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { ImportPipelineDialog } from "@/components/ImportPipelineDialog";
import { cn } from "@/lib/utils";

const CUSTOM = "Custom";

/**
 * Desktop pipeline navigation, nested under the sidebar's "Generate" item. Base
 * families (Illustrious, WAN 2.2…) list vertically; the active family expands to
 * show its mode sub-tabs (txt2img / img2img / inpaint / video). This replaces the
 * old full-width two-row PipelineTabs bar at the top of the page — that bar now
 * only shows on mobile, where there's no sidebar. Each pipeline is its own id.
 */
export function GenerateSubNav() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const match = useMatch("/generate/:id");
  const activeId = match?.params.id ?? "";
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

  if (pipelines.length === 0) return null;

  return (
    <div className="ml-5 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--color-line)] pl-2">
      {[...groups.entries()].map(([group, list]) => {
        const active = group === activeGroup;
        const Icon = list.some((p) => p.type === "video") ? Film : ImageIcon;
        return (
          <div key={group}>
            <button
              onClick={() => selectGroup(group)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                active
                  ? "text-[var(--color-text)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-elevated)]/50 hover:text-[var(--color-text)]",
              )}
            >
              <Icon
                className={cn("h-3.5 w-3.5 shrink-0", active && "text-[var(--color-amber)]")}
                strokeWidth={1.75}
              />
              <span className="truncate">{group}</span>
            </button>

            {active && (
              <div className="mb-1 mt-0.5 flex flex-col gap-0.5 pl-[1.35rem]">
                {list.map((p) => {
                  const on = p.id === activeId;
                  return (
                    <div key={p.id} className="group flex items-center gap-1">
                      <button
                        onClick={() => navigate(`/generate/${p.id}`)}
                        title={p.name}
                        className={cn(
                          "flex-1 truncate rounded-[var(--radius-sm)] px-2.5 py-1 text-left text-[12.5px] capitalize transition-colors",
                          on
                            ? "bg-[var(--color-amber)]/15 text-[var(--color-amber)]"
                            : "text-[var(--color-muted)] hover:bg-[var(--color-elevated)]/50 hover:text-[var(--color-text)]",
                        )}
                      >
                        {p.mode ?? p.name}
                      </button>
                      <button
                        onClick={() => remove(p.id, p.name)}
                        title="Remove pipeline"
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[var(--color-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={() => setImporting(true)}
        title="Import a workflow"
        className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] text-[var(--color-faint)] transition-colors hover:bg-[var(--color-elevated)]/50 hover:text-[var(--color-amber)]"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        Import workflow
      </button>

      <AnimatePresence>
        {importing && <ImportPipelineDialog onClose={() => setImporting(false)} />}
      </AnimatePresence>
    </div>
  );
}
