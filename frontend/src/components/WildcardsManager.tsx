import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { X, Braces, Plus, Trash2, Check, Loader2, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { confirm } from "@/lib/confirm";

/**
 * Manage prompt wildcard files (`data/wildcards/<name>.txt`). Each file is a list
 * of options (one per line); `__name__` in a prompt expands to a random line.
 * List on the left, plain-text editor on the right; edits take effect on the very
 * next generation (files are read fresh per job).
 */
export function WildcardsManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: names = [] } = useQuery({ queryKey: ["wildcards"], queryFn: api.wildcards });

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(""); // last saved/loaded content, for dirty check
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Load the selected file's contents.
  const { data: file } = useQuery({
    queryKey: ["wildcard", selected],
    queryFn: () => api.wildcard(selected!),
    enabled: Boolean(selected),
  });
  useEffect(() => {
    if (file && file.name === selected) {
      setContent(file.content);
      setLoaded(file.content);
    }
  }, [file, selected]);

  // Auto-select the first file once the list loads.
  useEffect(() => {
    if (!selected && names.length > 0) setSelected(names[0]!);
  }, [names, selected]);

  const dirty = content !== loaded;
  const lineCount = useMemo(
    () => content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).length,
    [content],
  );

  async function save() {
    if (!selected) return;
    setBusy(true);
    try {
      await api.saveWildcard(selected, content);
      setLoaded(content);
      qc.invalidateQueries({ queryKey: ["wildcards"] });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = newName.trim().replace(/\.txt$/i, "");
    if (!name || !/^[A-Za-z0-9_\-/]+$/.test(name)) return;
    if (names.includes(name)) {
      setSelected(name);
      setNewName("");
      return;
    }
    setBusy(true);
    try {
      await api.saveWildcard(name, "");
      await qc.invalidateQueries({ queryKey: ["wildcards"] });
      setSelected(name);
      setContent("");
      setLoaded("");
      setNewName("");
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    if (!(await confirm({ title: `Delete "${name}"?`, body: "This removes the wildcard file for good.", confirmLabel: "Delete", danger: true }))) {
      return;
    }
    await api.deleteWildcard(name);
    await qc.invalidateQueries({ queryKey: ["wildcards"] });
    if (selected === name) {
      setSelected(null);
      setContent("");
      setLoaded("");
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
        className="flex h-[80vh] max-h-[640px] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
        initial={{ scale: 0.97, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Braces className="h-4 w-4 text-[var(--color-violet)]" />
            <h2 className="font-display text-sm font-semibold">Prompt wildcards</h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* File list */}
          <div className="flex w-52 shrink-0 flex-col border-r border-[var(--color-line)]">
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {names.length === 0 && (
                <p className="px-2 py-4 text-center text-[11px] text-[var(--color-faint)]">
                  No wildcards yet. Create one below.
                </p>
              )}
              {names.map((name) => (
                <div
                  key={name}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs",
                    selected === name
                      ? "bg-[var(--color-line)] text-[var(--color-text)]"
                      : "text-[var(--color-muted)] hover:bg-[var(--color-elevated)]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(name)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <FileText className="h-3 w-3 shrink-0 text-[var(--color-faint)]" />
                    <span className="truncate font-mono">{name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(name)}
                    title="Delete"
                    className="shrink-0 text-[var(--color-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-[var(--color-line)] p-2">
              <div className="flex items-center gap-1">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                  placeholder="new-wildcard"
                  className="h-7 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2 font-mono text-[11px] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)]"
                />
                <button
                  type="button"
                  onClick={create}
                  disabled={!newName.trim() || busy}
                  title="Create wildcard"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] text-[var(--color-on-amber)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Editor */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-2">
                  <span className="font-mono text-xs text-[var(--color-text)]">
                    __{selected}__
                    <span className="ml-2 text-[var(--color-faint)]">
                      {lineCount} option{lineCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!dirty || busy}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : justSaved ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : null}
                    {justSaved ? "Saved" : "Save"}
                  </button>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  spellCheck={false}
                  placeholder={"One option per line, e.g.\ncrimson\nazure\nemerald\n\n# lines starting with # are ignored"}
                  className="min-h-0 flex-1 resize-none bg-[var(--color-ink)] px-4 py-3 font-mono text-xs leading-relaxed text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]"
                />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-[var(--color-faint)]">
                Select a wildcard to edit, or create a new one.
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[var(--color-line)] px-5 py-3 text-[11px] text-[var(--color-muted)]">
          Use <span className="font-mono text-[var(--color-text)]">__name__</span> in a prompt to pull a
          random line, or <span className="font-mono text-[var(--color-text)]">{"{a|b|c}"}</span> for a
          quick inline choice. Both re-roll on every image in a batch.
        </div>
      </motion.div>
    </motion.div>
  );
}
