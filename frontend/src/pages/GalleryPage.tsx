import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/ui/EmptyState";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";

// Server-side pagination page size (grows via "Load more" — no hard cap now).
const PAGE = 200;
import { AnimatePresence } from "framer-motion";
import {
  Images,
  Search,
  Heart,
  AlertCircle,
  Play,
  CheckSquare,
  Check,
  X,
  Trash2,
  Download,
  Columns2,
  FolderPlus,
  FolderMinus,
  Layers,
  Pencil,
} from "lucide-react";
import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { PageHeader } from "@/components/PageHeader";
import { GenerationDetail } from "@/components/GenerationDetail";
import { CompareView } from "@/components/CompareView";
import { AddToCollectionMenu } from "@/components/AddToCollectionMenu";
import { Mono } from "@/components/ui/primitives";
import { formatRelative, seedFingerprint, cn } from "@/lib/utils";
import type { GenerationRecord } from "@latent/shared";

/** "all" | "favorites" | a collection id. */
type Filter = "all" | "favorites" | string;

export function GalleryPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("open"));
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce the search box, then run it server-side (covers the whole library,
  // not just a first page).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  // Restart paging whenever the filter or search changes.
  useEffect(() => setLimit(PAGE), [filter, debouncedQuery]);

  const { data: items = [], isFetching } = useQuery({
    queryKey: ["generations", filter, debouncedQuery, limit],
    queryFn: () =>
      api.generations({
        limit,
        favorite: filter === "favorites" ? true : undefined,
        collection: filter !== "all" && filter !== "favorites" ? filter : undefined,
        search: debouncedQuery || undefined,
      }),
    placeholderData: keepPreviousData, // no flash of empty while paging/searching
  });
  const { data: collections = [] } = useQuery({
    queryKey: ["collections"],
    queryFn: () => api.collections(),
  });

  const activeCollection = collections.find((c) => c.id === filter) ?? null;

  const open = (id: string | null) => {
    setSelectedId(id);
    setSearchParams(id ? { open: id } : {});
  };

  // Search + collection/favorite filtering now happen server-side.
  const filtered = items;

  const live = selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["generations"] });
    queryClient.invalidateQueries({ queryKey: ["collections"] });
  };

  // ── Selection helpers ──────────────────────────────────────────────────────
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  function exitSelect() {
    setSelectMode(false);
    clearSelection();
  }
  const selectedRecords = useMemo(
    () => filtered.filter((g) => selected.has(g.id)),
    [filtered, selected],
  );

  async function bulkFavorite() {
    await Promise.all([...selected].map((id) => api.setFavorite(id, true)));
    refresh();
  }
  async function bulkDelete() {
    if (
      !(await confirm({
        title: `Delete ${selected.size} generation${selected.size > 1 ? "s" : ""}?`,
        body: "This can't be undone — the images are removed from disk.",
        danger: true,
        confirmLabel: "Delete",
      }))
    )
      return;
    await api.bulkDelete([...selected]);
    exitSelect();
    refresh();
  }
  async function bulkAddToCollection(collectionId: string) {
    await api.addToCollection(collectionId, [...selected]);
    refresh();
  }
  async function bulkRemoveFromCollection() {
    if (!activeCollection) return;
    await Promise.all([...selected].map((id) => api.removeFromCollection(activeCollection.id, id)));
    clearSelection();
    refresh();
  }
  function bulkDownload() {
    selectedRecords.forEach((r, i) => {
      const out = r.outputs[0];
      if (!out) return;
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = out.url;
        a.download = out.filename ?? "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 250);
    });
  }
  function startCompare() {
    const two = [...selected].slice(0, 2);
    if (two.length === 2) setCompareIds([two[0]!, two[1]!]);
  }

  const compareA = compareIds && items.find((i) => i.id === compareIds[0]);
  const compareB = compareIds && items.find((i) => i.id === compareIds[1]);

  return (
    <div className="pb-28">
      <PageHeader eyebrow="Library" title="Gallery">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2.5">
            <Search className="h-3.5 w-3.5 text-[var(--color-faint)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompts, tags, seeds"
              className="h-9 w-36 bg-transparent text-sm outline-none placeholder:text-[var(--color-faint)] sm:w-56"
            />
          </div>
          <button
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-sm transition-colors",
              selectMode
                ? "border-[var(--color-amber)] text-[var(--color-amber)]"
                : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
            )}
            title="Select multiple"
          >
            <CheckSquare className="h-4 w-4" />
            {selectMode ? "Done" : "Select"}
          </button>
        </div>
      </PageHeader>

      {/* Collections rail */}
      <CollectionsRail
        collections={collections}
        filter={filter}
        onFilter={(f) => {
          setFilter(f);
          clearSelection();
        }}
      />

      {/* Active-collection management */}
      {activeCollection && (
        <ManageCollection collection={activeCollection} onDone={() => setFilter("all")} refresh={refresh} />
      )}

      <div className="p-4 md:p-8">
        {filtered.length === 0 ? (
          items.length === 0 && filter === "all" && !debouncedQuery ? (
            <EmptyState
              icon={Images}
              title="No creations yet"
              hint="Head to Generate and make your first image or video — everything you create shows up here, searchable and taggable."
              action={
                <Link
                  to="/generate"
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-3.5 py-2 text-xs font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90"
                >
                  Go to Generate
                </Link>
              }
            />
          ) : (
            <EmptyState icon={Images} title={items.length === 0 ? "Nothing here yet" : "No matches"} />
          )
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((g) => (
                <GalleryTile
                  key={g.id}
                  record={g}
                  selectMode={selectMode}
                  selected={selected.has(g.id)}
                  onClick={() => (selectMode ? toggle(g.id) : open(g.id))}
                />
              ))}
            </div>
            {/* A full page came back → there are probably more. */}
            {items.length >= limit && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => setLimit((l) => l + PAGE)}
                  disabled={isFetching}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-4 py-2 text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-amber)] hover:text-[var(--color-text)] disabled:opacity-60"
                >
                  {isFetching ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating selection bar */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)]/95 px-2 py-1.5 shadow-2xl backdrop-blur-md">
          <span className="px-2 text-sm font-medium text-[var(--color-text)]">{selected.size} selected</span>
          <div className="mx-0.5 h-5 w-px bg-[var(--color-line)]" />
          <BarBtn onClick={bulkFavorite} icon={<Heart className="h-4 w-4" />}>Favorite</BarBtn>
          <AddToCollectionMenu
            align="left"
            onPick={bulkAddToCollection}
            trigger={() => (
              <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]">
                <FolderPlus className="h-4 w-4" /> Add to…
              </span>
            )}
          />
          {activeCollection && (
            <BarBtn onClick={bulkRemoveFromCollection} icon={<FolderMinus className="h-4 w-4" />}>Remove</BarBtn>
          )}
          <BarBtn onClick={bulkDownload} icon={<Download className="h-4 w-4" />}>Download</BarBtn>
          <BarBtn
            onClick={startCompare}
            disabled={selected.size !== 2}
            icon={<Columns2 className="h-4 w-4" />}
            title={selected.size !== 2 ? "Select exactly 2 to compare" : "Compare"}
          >
            Compare
          </BarBtn>
          <BarBtn onClick={bulkDelete} danger icon={<Trash2 className="h-4 w-4" />}>Delete</BarBtn>
          <div className="mx-0.5 h-5 w-px bg-[var(--color-line)]" />
          <button
            onClick={clearSelection}
            className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-faint)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
            title="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <AnimatePresence>
        {live && <GenerationDetail record={live} onClose={() => open(null)} />}
        {compareIds && compareA && compareB && (
          <CompareView a={compareA} b={compareB} onClose={() => setCompareIds(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Collections rail ───────────────────────────────────────────────────────────

function CollectionsRail({
  collections,
  filter,
  onFilter,
}: {
  collections: { id: string; name: string; count: number }[];
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-[var(--color-line)] px-4 py-3 md:px-8">
      <Chip active={filter === "all"} onClick={() => onFilter("all")} icon={<Layers className="h-3.5 w-3.5" />}>
        All
      </Chip>
      <Chip active={filter === "favorites"} onClick={() => onFilter("favorites")} icon={<Heart className="h-3.5 w-3.5" />}>
        Favorites
      </Chip>
      {collections.length > 0 && <div className="h-5 w-px shrink-0 bg-[var(--color-line)]" />}
      {collections.map((c) => (
        <Chip key={c.id} active={filter === c.id} onClick={() => onFilter(c.id)}>
          {c.name}
          <span className="ml-1.5 text-[10px] text-[var(--color-faint)]">{c.count}</span>
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
        active
          ? "border-[var(--color-amber)] bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
          : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ManageCollection({
  collection,
  onDone,
  refresh,
}: {
  collection: { id: string; name: string; count: number };
  onDone: () => void;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(collection.name);

  async function save() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== collection.name) await api.renameCollection(collection.id, trimmed);
    setEditing(false);
    refresh();
  }
  async function remove() {
    if (
      !(await confirm({
        title: `Delete collection "${collection.name}"?`,
        body: "The images stay in your gallery — only the collection is removed.",
        danger: true,
        confirmLabel: "Delete",
      }))
    )
      return;
    await api.deleteCollection(collection.id);
    onDone();
    refresh();
  }

  return (
    <div className="flex items-center gap-2 px-4 pt-4 md:px-8">
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2 text-sm outline-none focus:border-[var(--color-amber)]"
        />
      ) : (
        <h2 className="font-display text-lg">{collection.name}</h2>
      )}
      <span className="text-xs text-[var(--color-faint)]">{collection.count} items</span>
      <button
        onClick={() => setEditing(true)}
        className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--color-faint)] transition-colors hover:text-[var(--color-text)]"
        title="Rename"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={remove}
        className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--color-faint)] transition-colors hover:text-[var(--color-danger)]"
        title="Delete collection"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Bulk-bar button ─────────────────────────────────────────────────────────────

function BarBtn({
  onClick,
  icon,
  children,
  danger,
  disabled,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        danger
          ? "text-[var(--color-muted)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
          : "text-[var(--color-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Tile ────────────────────────────────────────────────────────────────────────

function GalleryTile({
  record,
  selectMode,
  selected,
  onClick,
}: {
  record: GenerationRecord;
  selectMode: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const failed = record.status === "failed";
  const videoOutput = record.outputs.find((o) => o.type === "video");
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface)] text-left transition-colors",
        selected
          ? "border-[var(--color-amber)] ring-1 ring-[var(--color-amber)]"
          : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]",
      )}
    >
      <div className="relative aspect-square bg-[var(--color-ink)]">
        {record.thumbnail ? (
          <img
            src={record.thumbnail}
            alt=""
            loading="lazy"
            className={cn(
              "h-full w-full object-cover transition-transform duration-300",
              !selectMode && "group-hover:scale-[1.03]",
            )}
          />
        ) : videoOutput ? (
          <video
            src={`${videoOutput.url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
            onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            {failed ? (
              <AlertCircle className="h-5 w-5 text-[var(--color-danger)]/60" />
            ) : (
              <span className="font-mono text-[10px] text-[var(--color-faint)]">{record.status}</span>
            )}
          </div>
        )}

        {/* Selection overlay */}
        {selectMode && (
          <div className={cn("absolute inset-0 transition-colors", selected ? "bg-[var(--color-amber)]/15" : "bg-black/0 group-hover:bg-black/10")}>
            <div
              className={cn(
                "absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full border-2 transition-colors",
                selected
                  ? "border-[var(--color-amber)] bg-[var(--color-amber)] text-black"
                  : "border-white/80 bg-black/30",
              )}
            >
              {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            </div>
          </div>
        )}

        {videoOutput && !selectMode && (
          <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-1.5 py-0.5">
            <Play className="h-3 w-3 fill-white text-white" />
          </div>
        )}
        {record.favorite && !selectMode && (
          <div className="absolute right-2 top-2">
            <Heart className="h-4 w-4 fill-[var(--color-amber)] text-[var(--color-amber)] drop-shadow" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <Mono className="text-[10px]">{seedFingerprint(record.seed)}</Mono>
        <span className="text-[10px] text-[var(--color-faint)]">{formatRelative(record.createdAt)}</span>
      </div>
    </button>
  );
}
