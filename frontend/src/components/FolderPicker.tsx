import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { X, ArrowUp, Folder, HardDrive, FolderSearch, Loader2, Check } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

/**
 * Browse the local filesystem (drives → folders) and pick a directory. Used to set
 * a model "home" folder without typing the path by hand — the backend lists dirs
 * since a browser has no native folder picker that yields a real filesystem path.
 */
export function FolderPicker({
  initialPath,
  onPick,
  onClose,
}: {
  initialPath?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState(initialPath?.trim() ?? "");
  const { data, isFetching } = useQuery({
    queryKey: ["browse-dirs", path],
    queryFn: () => api.browseDirs(path),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const atDrives = !path;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
        initial={{ scale: 0.97, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FolderSearch className="h-4 w-4 text-[var(--color-amber)]" />
            <h2 className="font-display text-sm font-semibold">Pick a folder</h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Location bar + up */}
        <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-2">
          <button
            onClick={() => data && data.parent != null && setPath(data.parent)}
            disabled={atDrives}
            title="Up one level"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-amber)] disabled:opacity-30"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-text)]" title={path || "This PC"}>
            {path || "This PC"}
          </span>
          {isFetching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-faint)]" />}
        </div>

        {/* Folder list */}
        <div className="min-h-[220px] flex-1 overflow-y-auto p-2">
          {!data && isFetching ? (
            <div className="grid h-40 place-items-center text-[var(--color-faint)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : data && data.dirs.length > 0 ? (
            data.dirs.map((d) => (
              <button
                key={d.path}
                onClick={() => setPath(d.path)}
                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-elevated)]"
              >
                {atDrives ? (
                  <HardDrive className="h-4 w-4 shrink-0 text-[var(--color-muted)]" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-[var(--color-amber)]" />
                )}
                <span className="min-w-0 truncate">{d.name}</span>
              </button>
            ))
          ) : (
            <div className="grid h-40 place-items-center px-4 text-center text-xs text-[var(--color-faint)]">
              No subfolders here — use this folder, or go back up.
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--color-line)] px-5 py-3.5">
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-faint)]">
            {path ? `Select "${path}"` : "Open a drive to browse into it."}
          </span>
          <button
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            onClick={() => path && onPick(path)}
            disabled={!path}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-medium text-[var(--color-on-amber)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="h-4 w-4" /> Use this folder
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
