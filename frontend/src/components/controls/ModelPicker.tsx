import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, ChevronDown, ExternalLink, Download, Box, Check, LayoutGrid, FolderPlus } from "lucide-react";
import { api } from "@/lib/api";
import { AddToModelFolderMenu } from "@/components/AddToModelFolderMenu";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModelInfo, ModelKind } from "@latent/shared";

interface Props {
  kind: ModelKind;
  /** Valid selectable filenames (object_info options). */
  options: string[];
  value: string;
  onChange: (file: string) => void;
}

export function ModelPicker({ kind, options, value, onChange }: Props) {
  const [mode, setMode] = useState<"closed" | "dropdown" | "gallery">("closed");
  const { data: models = [] } = useQuery({
    queryKey: ["models", kind],
    queryFn: () => api.models(kind),
    staleTime: 60_000,
  });

  // Join the valid options to catalog metadata; options drive what's selectable.
  const byFile = useMemo(() => new Map(models.map((m) => [m.file, m])), [models]);
  const current = byFile.get(value);
  // Hide files that landed in the wrong folder (e.g. text encoders / projections
  // sitting in the checkpoints dir) from model selectors.
  const cleanOptions = useMemo(() => options.filter((o) => !isMisplaced(kind, o)), [options, kind]);

  const pick = (f: string) => {
    onChange(f);
    setMode("closed");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMode(mode === "dropdown" ? "closed" : "dropdown")}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] p-1 pr-2.5 text-left transition-colors hover:border-[var(--color-amber)]"
      >
        <Thumb kind={kind} model={current} file={value} className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-[var(--color-text)]">
            {current?.name ?? cleanFallback(value)}
          </div>
          {current?.baseModel && (
            <div className="truncate text-[10px] text-[var(--color-faint)]">{current.baseModel}</div>
          )}
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-faint)]" />
      </button>

      {mode === "dropdown" && (
        <CompactModelDropdown
          kind={kind}
          options={cleanOptions}
          value={value}
          byFile={byFile}
          onPick={pick}
          onBrowse={() => setMode("gallery")}
          onClose={() => setMode("closed")}
        />
      )}

      <AnimatePresence>
        {mode === "gallery" && (
          <ModelPickerDialog
            kind={kind}
            options={cleanOptions}
            value={value}
            byFile={byFile}
            onPick={pick}
            onClose={() => setMode("closed")}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CompactModelDropdown({
  kind,
  options,
  value,
  byFile,
  onPick,
  onBrowse,
  onClose,
}: {
  kind: ModelKind;
  options: string[];
  value: string;
  byFile: Map<string, ModelInfo>;
  onPick: (file: string) => void;
  onBrowse: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return options
      .map((file) => byFile.get(file) ?? fallbackInfo(kind, file))
      .filter((m) => !t || `${m.name} ${m.file} ${m.baseModel ?? ""}`.toLowerCase().includes(t));
  }, [options, byFile, kind, q]);

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-elevated)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-[var(--color-faint)]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${items.length}…`}
            className="h-5 w-full bg-transparent text-xs outline-none placeholder:text-[var(--color-faint)]"
          />
          <button
            type="button"
            onClick={onBrowse}
            title="Browse all with previews"
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--color-violet)] hover:bg-[var(--color-line)]"
          >
            <LayoutGrid className="h-3 w-3" /> Browse
          </button>
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          {items.map((m) => (
            <button
              key={m.file}
              type="button"
              onClick={() => onPick(m.file)}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1 text-left",
                m.file === value ? "bg-[var(--color-line)]" : "hover:bg-[var(--color-line)]/50",
              )}
            >
              <Thumb kind={kind} model={m} file={m.file} className="h-6 w-6 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text)]">{m.name}</span>
              {m.baseModel && (
                <span className="shrink-0 text-[9px] text-[var(--color-faint)]">{m.baseModel}</span>
              )}
            </button>
          ))}
          {items.length === 0 && (
            <div className="px-3 py-2 text-xs text-[var(--color-faint)]">No matches.</div>
          )}
        </div>
      </div>
    </>
  );
}

export function ModelPickerDialog({
  kind,
  options,
  value,
  byFile,
  onPick,
  onClose,
}: {
  kind: ModelKind;
  options: string[];
  value: string;
  byFile: Map<string, ModelInfo>;
  onPick: (file: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const query = q.trim().toLowerCase();

  // Folders the user created for this kind, to browse the picker by folder.
  const { data: folders = [] } = useQuery({
    queryKey: ["model-folders", kind],
    queryFn: () => api.modelFolders(kind),
  });
  const { data: folderModels } = useQuery({
    queryKey: ["models", kind, folderId],
    queryFn: () => api.models(kind, folderId!),
    enabled: !!folderId,
    staleTime: 60_000,
  });
  const folderFiles = folderId ? new Set((folderModels ?? []).map((m) => m.file)) : null;

  const items = useMemo(() => {
    return options
      .map((file) => byFile.get(file) ?? fallbackInfo(kind, file))
      .filter((m) => {
        if (folderFiles && !folderFiles.has(m.file)) return false;
        if (!query) return true;
        return [m.name, m.file, m.baseModel, ...(m.tags ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
  }, [options, byFile, kind, query, folderFiles]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
        initial={{ scale: 0.97, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <Search className="h-4 w-4 text-[var(--color-faint)]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${items.length} ${kind}s…`}
            className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-faint)]"
          />
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {folders.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--color-line)] px-3 py-2">
            <FolderChip label="All" active={folderId === null} onClick={() => setFolderId(null)} />
            {folders.map((f) => (
              <FolderChip
                key={f.id}
                label={f.name}
                count={f.count}
                active={folderId === f.id}
                onClick={() => setFolderId(f.id)}
              />
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
          {items.map((m) => (
            <ModelCard key={m.file} kind={kind} model={m} selected={m.file === value} onPick={() => onPick(m.file)} />
          ))}
          {items.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-[var(--color-muted)]">No matches.</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function FolderChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-[var(--color-amber)] bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
          : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
      )}
    >
      {label}
      {count != null && <span className="text-[10px] text-[var(--color-faint)]">{count}</span>}
    </button>
  );
}

const KIND_LABEL: Record<ModelKind, string> = {
  checkpoint: "CKPT",
  diffusion: "UNet",
  lora: "LoRA",
  vae: "VAE",
  upscale: "Upscale",
  controlnet: "CtrlNet",
  embedding: "Embed",
};

export function ModelCard({
  kind,
  model,
  selected = false,
  onPick,
  showKind = false,
}: {
  kind: ModelKind;
  model: ModelInfo;
  selected?: boolean;
  /** When omitted the card is display-only (e.g. the Model Browser). */
  onPick?: () => void;
  /** Show a small type chip (for the mixed "All" view). */
  showKind?: boolean;
}) {
  const queryClient = useQueryClient();
  const [enriching, setEnriching] = useState(false);

  const { data: folderIds = [] } = useQuery({
    queryKey: ["model-folders-for", kind, model.file],
    queryFn: () => api.modelFoldersFor(kind, model.file),
  });
  async function addToFolder(folderId: string) {
    await api.addToModelFolder(folderId, [{ kind, file: model.file }]);
    queryClient.invalidateQueries({ queryKey: ["model-folders-for", kind, model.file] });
    queryClient.invalidateQueries({ queryKey: ["model-folders"] });
  }

  async function enrich(e: React.MouseEvent) {
    e.stopPropagation();
    setEnriching(true);
    try {
      await api.enrichModel(kind, model.file);
      queryClient.invalidateQueries({ queryKey: ["models", kind] });
    } finally {
      setEnriching(false);
    }
  }

  const interactive = Boolean(onPick);

  return (
    <div
      {...(interactive
        ? {
            role: "button",
            tabIndex: 0,
            onClick: onPick,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick!();
              }
            },
          }
        : {})}
      className={cn(
        "flex h-[100px] gap-3 overflow-hidden rounded-[var(--radius-md)] border-2 p-2 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-amber)]",
        interactive && "cursor-pointer",
        selected
          ? "border-[var(--color-amber)] bg-[var(--color-elevated)]"
          : "border-[var(--color-line-strong)] hover:border-[var(--color-amber)]/50 hover:bg-[var(--color-elevated)]/50",
      )}
    >
      <Thumb kind={kind} model={model} file={model.file} className="h-full w-[76px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-[var(--color-text)]">{model.name}</span>
          {showKind && (
            <span className="shrink-0 rounded bg-[var(--color-elevated)] px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
              {KIND_LABEL[kind]}
            </span>
          )}
          {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-amber)]" />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {model.baseModel && <Badge tone="violet">{model.baseModel}</Badge>}
          {model.versionName && (
            <span className="text-[10px] text-[var(--color-faint)]">{model.versionName}</span>
          )}
        </div>
        {model.trainedWords && model.trainedWords.length > 0 && (
          <div className="mt-1.5 flex gap-1 overflow-hidden">
            {model.trainedWords.slice(0, 4).map((w) => (
              <span
                key={w}
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard?.writeText(w);
                }}
                className="shrink-0 whitespace-nowrap rounded bg-[var(--color-ink)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-amber)] hover:bg-[var(--color-line)]"
                title="Copy trigger word"
              >
                {w}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-faint)]">
          {model.author && <span>by {model.author}</span>}
          {model.stats?.downloadCount != null && <span>↓ {formatCount(model.stats.downloadCount)}</span>}
          {model.civitaiModelId && (
            <a
              href={`https://civitai.com/models/${model.civitaiModelId}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 text-[var(--color-violet)] hover:underline"
            >
              Civitai <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {model.source !== "local" && (
            <span
              onClick={enrich}
              className="inline-flex items-center gap-0.5 text-[var(--color-muted)] hover:text-[var(--color-amber)]"
            >
              <Download className={cn("h-2.5 w-2.5", enriching && "animate-pulse")} />
              {enriching ? "…" : "Fetch"}
            </span>
          )}
          <AddToModelFolderMenu
            onPick={addToFolder}
            memberIds={folderIds}
            trigger={(open) => (
              <span
                title="Add to folder"
                className={cn(
                  "inline-flex items-center gap-0.5 hover:text-[var(--color-amber)]",
                  open || folderIds.length > 0 ? "text-[var(--color-amber)]" : "text-[var(--color-muted)]",
                )}
              >
                <FolderPlus className="h-2.5 w-2.5" />
                {folderIds.length > 0 ? folderIds.length : "Folder"}
              </span>
            )}
          />
        </div>
      </div>
    </div>
  );
}

export function Thumb({
  kind,
  model,
  file,
  className,
}: {
  kind: ModelKind;
  model?: ModelInfo;
  file: string;
  className?: string;
}) {
  const hasImage = model && (model.hasPreview || model.previewUrl);
  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-ink)]", className)}>
      {hasImage ? (
        <img
          src={api.modelPreviewUrl(kind, file)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-[var(--color-faint)]">
          <Box className="h-1/2 w-1/2" strokeWidth={1.25} />
        </div>
      )}
    </div>
  );
}

function cleanFallback(file: string): string {
  return file.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
}

/** Text encoders/projections etc. sometimes sit in the checkpoints folder — hide them. */
function isMisplaced(kind: ModelKind, file: string): boolean {
  if (kind !== "checkpoint" && kind !== "diffusion") return false;
  return /text[_-]?projection|text[_-]?encoder|t5xxl|umt5|clip[_-]?(l|g|vision)\b/i.test(file);
}

function fallbackInfo(kind: ModelKind, file: string): ModelInfo {
  return { file, kind, name: cleanFallback(file), hasPreview: false, source: "none" };
}

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
