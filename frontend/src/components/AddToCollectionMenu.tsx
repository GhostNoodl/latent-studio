import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Plus, Check } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Trigger + popover for filing generations into a collection. Lists existing
 * collections (click to add) and creates new ones inline. `memberIds` marks
 * collections the current item already belongs to (single-item use).
 */
export function AddToCollectionMenu({
  onPick,
  memberIds,
  align = "left",
  trigger,
}: {
  onPick: (collectionId: string) => void | Promise<void>;
  memberIds?: string[];
  align?: "left" | "right";
  trigger?: (open: boolean) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: collections = [] } = useQuery({
    queryKey: ["collections"],
    queryFn: () => api.collections(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const c = await api.createCollection(trimmed);
    setName("");
    queryClient.invalidateQueries({ queryKey: ["collections"] });
    await onPick(c.id);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} type="button">
        {trigger ? (
          trigger(open)
        ) : (
          <span className="flex items-center gap-1.5">
            <FolderPlus className="h-4 w-4" /> Add to collection
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute bottom-full z-50 mb-2 w-60 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="max-h-56 overflow-y-auto py-1">
            {collections.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--color-faint)]">No collections yet.</p>
            )}
            {collections.map((c) => {
              const member = memberIds?.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={async () => {
                    await onPick(c.id);
                    queryClient.invalidateQueries({ queryKey: ["collections"] });
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-elevated)]"
                >
                  <span className="truncate">{c.name}</span>
                  {member ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-good)]" />
                  ) : (
                    <span className="shrink-0 text-[10px] text-[var(--color-faint)]">{c.count}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 border-t border-[var(--color-line)] p-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="New collection"
              className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)]"
            />
            <button
              onClick={create}
              disabled={!name.trim()}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-amber)] disabled:opacity-40"
              title="Create collection"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
