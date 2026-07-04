import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { X, Upload, Image as ImageIcon, Film, FileJson } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Import a ComfyUI API-format workflow (paste or upload). The backend derives the
 * param manifest from /object_info, so all we collect is name, type, and the JSON.
 */
export function ImportPipelineDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"image" | "video">("image");
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Validate the pasted text is an API-format workflow (flat map of nodeId → {class_type, inputs}).
  const parsed = useMemo(() => {
    const text = json.trim();
    if (!text) return { ok: false as const };
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const nodes = Object.values(obj) as { class_type?: unknown }[];
        const looksApi = nodes.length > 0 && nodes.every((n) => n && typeof n === "object" && "class_type" in n);
        if (looksApi) return { ok: true as const, count: nodes.length, workflow: obj as Record<string, unknown> };
        return { ok: false as const, hint: "Not API format — export with “Save (API Format)” in ComfyUI, not the normal Save." };
      }
      return { ok: false as const, hint: "Expected a JSON object of nodes." };
    } catch {
      return { ok: false as const, hint: "Invalid JSON." };
    }
  }, [json]);

  async function loadFile(file: File) {
    setName((n) => n || file.name.replace(/\.json$/i, ""));
    setJson(await file.text());
  }

  async function submit() {
    if (!parsed.ok || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const manifest = await api.importPipeline({ name: name.trim(), type, workflow: parsed.workflow });
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      onClose();
      navigate(`/generate/${manifest.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
        initial={{ scale: 0.97, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-[var(--color-amber)]" />
            <h2 className="font-display text-sm font-semibold">Import workflow</h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-muted)]">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My SDXL pipeline"
              className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 text-sm outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-muted)]">Output type</label>
            <div className="flex gap-2">
              <TypeChoice active={type === "image"} onClick={() => setType("image")} icon={<ImageIcon className="h-3.5 w-3.5" />}>
                Image
              </TypeChoice>
              <TypeChoice active={type === "video"} onClick={() => setType("video")} icon={<Film className="h-3.5 w-3.5" />}>
                Video
              </TypeChoice>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--color-muted)]">Workflow JSON (API format)</label>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-amber)]"
              >
                <Upload className="h-3 w-3" /> Upload .json
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadFile(f);
                }}
              />
            </div>
            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) loadFile(f);
              }}
              rows={8}
              placeholder='Paste or drop the ComfyUI API-format JSON here…'
              className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 py-2 font-mono text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)]"
            />
            {json.trim() && (
              <p className={cn("text-[11px]", parsed.ok ? "text-[var(--color-good)]" : "text-[var(--color-danger)]")}>
                {parsed.ok ? `✓ Valid — ${parsed.count} nodes detected` : parsed.hint}
              </p>
            )}
            <p className="text-[11px] text-[var(--color-faint)]">
              In ComfyUI, enable dev mode and use <span className="font-mono">Save (API Format)</span>. The
              full param manifest is derived automatically from your node catalog.
            </p>
          </div>

          {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-line)] px-5 py-3.5">
          <button onClick={onClose} className="rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!parsed.ok || !name.trim() || busy}
            className="rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TypeChoice({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-2 text-xs transition-colors",
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
