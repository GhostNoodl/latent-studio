import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Boxes,
  Layers,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Folder,
  Copy,
  ExternalLink,
  Download,
  Eye,
  EyeOff,
  MoreVertical,
} from "lucide-react";
import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModelCard } from "@/components/controls/ModelPicker";
import { ContextMenu, type MenuItem } from "@/components/ContextMenu";
import { cn } from "@/lib/utils";
import type { ModelInfo, ModelKind } from "@latent/shared";

type KindTab = ModelKind | "all";

const KINDS: { key: KindTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "checkpoint", label: "Checkpoints" },
  { key: "lora", label: "LoRAs" },
  { key: "diffusion", label: "Diffusion / UNet" },
  { key: "vae", label: "VAE" },
  { key: "upscale", label: "Upscalers" },
  { key: "controlnet", label: "ControlNet" },
  { key: "embedding", label: "Embeddings" },
];

/** DnD payload type — a JSON {kind, file} model reference. */
const DND_MIME = "application/x-latent-model";
/** Sentinel folder id for the "Hidden" view. */
const HIDDEN = "__hidden__";

export function ModelsPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<KindTab>("checkpoint");
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [draggingFile, setDraggingFile] = useState<string | null>(null);

  const inHidden = folder === HIDDEN;
  const { data: models = [], isLoading } = useQuery({
    queryKey: ["models", kind, folder],
    queryFn: () =>
      inHidden ? api.models(kind, undefined, { hidden: true }) : api.models(kind, folder ?? undefined),
    staleTime: 60_000,
  });
  const { data: allModels = [] } = useQuery({
    queryKey: ["models", kind, null],
    queryFn: () => api.models(kind),
    staleTime: 60_000,
  });
  // Hidden models of this kind (drives the "Hidden" sidebar row + count).
  const { data: hiddenList = [] } = useQuery({
    queryKey: ["models", kind, HIDDEN],
    queryFn: () => api.models(kind, undefined, { hidden: true }),
    staleTime: 60_000,
  });
  // In the "All" tab, counts are folder totals across every type — so you can
  // always tell which folders have stuff, regardless of the type you're viewing.
  const { data: folders = [] } = useQuery({
    queryKey: ["model-folders", kind],
    queryFn: () => api.modelFolders(kind === "all" ? undefined : kind),
  });

  const activeFolder = folders.find((f) => f.id === folder) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) =>
      [m.name, m.file, m.baseModel, m.author, ...(m.trainedWords ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [models, query]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["models"] });
    queryClient.invalidateQueries({ queryKey: ["model-folders"] });
  };
  const invalidateMember = (mk: ModelKind, file: string) =>
    queryClient.invalidateQueries({ queryKey: ["model-folders-for", mk, file] });

  async function addToFolder(folderId: string, mk: ModelKind, file: string) {
    await api.addToModelFolder(folderId, [{ kind: mk, file }]);
    refresh();
    invalidateMember(mk, file);
  }
  async function removeFromFolder(folderId: string, mk: ModelKind, file: string) {
    await api.removeFromModelFolder(folderId, mk, file);
    refresh();
    invalidateMember(mk, file);
  }

  // Right-click a model card → quick actions (folder toggles + utilities).
  async function openCardMenu(e: React.MouseEvent, model: ModelInfo) {
    e.preventDefault();
    const mk = model.kind;
    const memberIds = await api.modelFoldersFor(mk, model.file);
    const items: MenuItem[] = folders.map((f) => {
      const member = memberIds.includes(f.id);
      return {
        label: f.name,
        icon: <Folder className="h-3.5 w-3.5" />,
        trailing: member ? <Check className="h-3.5 w-3.5 text-[var(--color-good)]" /> : undefined,
        onClick: () => (member ? removeFromFolder(f.id, mk, model.file) : addToFolder(f.id, mk, model.file)),
      };
    });
    if (folders.length) items.push({ separator: true });
    items.push({
      label: "Copy name",
      icon: <Copy className="h-3.5 w-3.5" />,
      onClick: () => void navigator.clipboard?.writeText(model.name),
    });
    if (model.trainedWords?.length) {
      items.push({
        label: "Copy trigger words",
        icon: <Copy className="h-3.5 w-3.5" />,
        onClick: () => void navigator.clipboard?.writeText(model.trainedWords!.join(", ")),
      });
    }
    if (model.civitaiModelId) {
      items.push({
        label: "Open on Civitai",
        icon: <ExternalLink className="h-3.5 w-3.5" />,
        onClick: () => window.open(`https://civitai.com/models/${model.civitaiModelId}`, "_blank"),
      });
    }
    if (model.source !== "local") {
      items.push({
        label: "Fetch metadata",
        icon: <Download className="h-3.5 w-3.5" />,
        onClick: async () => {
          await api.enrichModel(mk, model.file);
          queryClient.invalidateQueries({ queryKey: ["models"] });
        },
      });
    }
    items.push({ separator: true });
    items.push(
      inHidden
        ? {
            label: "Unhide",
            icon: <Eye className="h-3.5 w-3.5" />,
            onClick: async () => {
              await api.hideModel(mk, model.file, false);
              refresh();
            },
          }
        : {
            label: "Hide from library",
            icon: <EyeOff className="h-3.5 w-3.5" />,
            onClick: async () => {
              await api.hideModel(mk, model.file, true);
              refresh();
            },
          },
    );
    items.push({
      label: "Delete from disk",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      onClick: async () => {
        if (
          !(await confirm({
            title: `Delete "${model.name}"?`,
            body: "This permanently removes the model file and its sidecars from disk.",
            danger: true,
            confirmLabel: "Delete",
          }))
        )
          return;
        await api.deleteModelFile(mk, model.file);
        refresh();
      },
    });
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader eyebrow="Library" title="Models">
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2.5">
          <Search className="h-3.5 w-3.5 text-[var(--color-faint)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, base, trigger words"
            className="h-9 w-40 bg-transparent text-sm outline-none placeholder:text-[var(--color-faint)] sm:w-64"
          />
        </div>
      </PageHeader>

      {/* Kind rail */}
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--color-line)] px-4 py-3 md:px-8">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => {
              setKind(k.key);
              setFolder(null);
            }}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors",
              kind === k.key
                ? "border-[var(--color-amber)] bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
                : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <FolderSidebar
          folders={folders}
          selected={folder}
          onSelect={setFolder}
          totalCount={allModels.length}
          hiddenCount={hiddenList.length}
          refresh={refresh}
          dragActive={draggingFile !== null}
          onDropModel={(folderId, mk, file) => addToFolder(folderId, mk, file)}
        />

        {/* Grid */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mb-4 flex items-center gap-2 text-xs text-[var(--color-faint)]">
            {isLoading ? "Scanning…" : `${filtered.length} model${filtered.length === 1 ? "" : "s"}`}
            {inHidden ? (
              <span>· hidden from your library (right-click → Unhide)</span>
            ) : activeFolder ? (
              <span>
                in <span className="text-[var(--color-amber)]">{activeFolder.name}</span>
              </span>
            ) : (
              folders.length > 0 && <span>· drag cards onto a folder to organize</span>
            )}
          </div>
          {!isLoading && filtered.length === 0 ? (
            models.length === 0 && !activeFolder && !inHidden ? (
              <EmptyState
                icon={Boxes}
                title="No models here yet"
                hint="Download models from Discover — or re-run the first-run setup (Settings → Getting started) for a curated starter set."
                action={
                  <Link
                    to="/discover"
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-3.5 py-2 text-xs font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90"
                  >
                    Browse Discover
                  </Link>
                }
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-24 text-center text-[var(--color-muted)]">
                <Boxes className="h-7 w-7 text-[var(--color-faint)]" strokeWidth={1.5} />
                <p className="text-sm">
                  {inHidden
                    ? "Nothing hidden here."
                    : activeFolder
                      ? kind === "all"
                        ? "This folder is empty — drag models in, or use ⊞ Folder on a card."
                        : "No models of this type in the folder — switch to All to see everything in it."
                      : "No matches."}
                </p>
              </div>
            )
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((m) => (
                <div
                  key={m.file}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: m.kind, file: m.file }));
                    e.dataTransfer.effectAllowed = "copy";
                    setDraggingFile(m.file);
                  }}
                  onDragEnd={() => setDraggingFile(null)}
                  onContextMenu={(e) => openCardMenu(e, m)}
                  className={cn(
                    "group relative cursor-grab transition-opacity active:cursor-grabbing",
                    draggingFile === m.file && "opacity-40",
                  )}
                >
                  <ModelCard kind={m.kind} model={m} showKind={kind === "all"} />
                  {activeFolder && (
                    <button
                      onClick={() => removeFromFolder(activeFolder.id, m.kind, m.file)}
                      title={`Remove from ${activeFolder.name}`}
                      className="absolute right-1.5 top-1.5 hidden h-6 w-6 place-items-center rounded-full bg-black/60 text-white/80 hover:text-[var(--color-danger)] group-hover:grid"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

// ── Folder sidebar (drop targets + right-click rename/delete) ────────────────

function FolderSidebar({
  folders,
  selected,
  onSelect,
  totalCount,
  hiddenCount,
  refresh,
  dragActive,
  onDropModel,
}: {
  folders: { id: string; name: string; count: number }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  totalCount: number;
  hiddenCount: number;
  refresh: () => void;
  dragActive: boolean;
  onDropModel: (folderId: string, kind: ModelKind, file: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const f = await api.createModelFolder(trimmed);
    setName("");
    setCreating(false);
    refresh();
    onSelect(f.id);
  }
  async function rename(id: string, next: string, current: string) {
    if (next.trim() && next.trim() !== current) await api.renameModelFolder(id, next.trim());
    setEditingId(null);
    refresh();
  }
  async function remove(id: string, fname: string) {
    if (
      !(await confirm({
        title: `Delete folder "${fname}"?`,
        body: "The models themselves aren't touched — only the folder.",
        danger: true,
        confirmLabel: "Delete",
      }))
    )
      return;
    await api.deleteModelFolder(id);
    if (selected === id) onSelect(null);
    refresh();
  }

  const folderMenuItems = (f: { id: string; name: string }): MenuItem[] => [
    { label: "Rename", icon: <Pencil className="h-3.5 w-3.5" />, onClick: () => setEditingId(f.id) },
    { label: "Delete folder", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onClick: () => remove(f.id, f.name) },
  ];

  function handleDrop(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    try {
      const { kind, file } = JSON.parse(raw) as { kind: ModelKind; file: string };
      onDropModel(folderId, kind, file);
    } catch {
      /* ignore malformed payload */
    }
  }

  return (
    <aside className="w-48 shrink-0 space-y-0.5 overflow-y-auto border-r border-[var(--color-line)] p-3 md:w-52">
      <SidebarRow active={selected === null} onClick={() => onSelect(null)} icon={<Layers className="h-3.5 w-3.5" />} count={totalCount}>
        All
      </SidebarRow>

      {folders.map((f) =>
        editingId === f.id ? (
          <input
            key={f.id}
            autoFocus
            defaultValue={f.name}
            onBlur={(e) => rename(f.id, e.target.value, f.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename(f.id, (e.target as HTMLInputElement).value, f.name);
              if (e.key === "Escape") setEditingId(null);
            }}
            className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-amber)] bg-[var(--color-ink)] px-2 text-sm outline-none"
          />
        ) : (
          <div
            key={f.id}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDragOver(f.id);
            }}
            onDragLeave={() => setDragOver((d) => (d === f.id ? null : d))}
            onDrop={(e) => handleDrop(e, f.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, items: folderMenuItems(f) });
            }}
            className={cn(
              "group relative rounded-[var(--radius-sm)] transition-colors",
              dragOver === f.id
                ? "bg-[var(--color-amber)]/15 ring-1 ring-inset ring-[var(--color-amber)]"
                : dragActive && "ring-1 ring-inset ring-[var(--color-line-strong)]",
            )}
          >
            <SidebarRow active={selected === f.id} onClick={() => onSelect(f.id)} count={f.count}>
              {f.name}
            </SidebarRow>
            {/* Hover affordance so folder actions aren't hidden behind right-click. */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ x: r.right, y: r.bottom, items: folderMenuItems(f) });
              }}
              title="Folder actions"
              className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[var(--radius-xs)] bg-[var(--color-elevated)] text-[var(--color-muted)] opacity-0 transition-opacity hover:text-[var(--color-text)] group-hover:opacity-100 focus-visible:opacity-100"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </div>
        ),
      )}

      {creating ? (
        <div className="flex items-center gap-1 pt-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Folder name"
            className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2 text-xs outline-none focus:border-[var(--color-amber)]"
          />
          <button onClick={create} className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--color-muted)] hover:text-[var(--color-amber)]">
            <Check className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="mt-1 flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-amber)]"
        >
          <Plus className="h-3.5 w-3.5" /> New folder
        </button>
      )}

      {hiddenCount > 0 && (
        <div className="mt-2 border-t border-[var(--color-line)] pt-2">
          <SidebarRow
            active={selected === HIDDEN}
            onClick={() => onSelect(HIDDEN)}
            icon={<EyeOff className="h-3.5 w-3.5" />}
            count={hiddenCount}
          >
            Hidden
          </SidebarRow>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}

function SidebarRow({
  active,
  onClick,
  icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-[var(--color-elevated)] text-[var(--color-text)]"
          : "text-[var(--color-muted)] hover:bg-[var(--color-elevated)]/50 hover:text-[var(--color-text)]",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="shrink-0 text-[10px] text-[var(--color-faint)]">{count}</span>
    </button>
  );
}
