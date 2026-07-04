import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Minus, Plus, Box, ScrollText, X, Bookmark } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { adjustWeight, insertToken, type EditResult } from "@/lib/promptEdit";
import { promptText } from "@/lib/prompt-dialog";
import { ModelPickerDialog } from "@/components/controls/ModelPicker";
import type { ModelInfo } from "@latent/shared";

type ApplyEdit = (edit: (text: string, start: number, end: number) => EditResult) => void;

/**
 * Slim tool row under a prompt textarea: emphasis −/+ (A1111 `(word:1.1)`
 * weighting, also on Ctrl+↑/↓), an embeddings picker that inserts
 * `embedding:<name>`, and a global snippet library (save selection / insert).
 * All actions run through `applyEdit`, which reads + restores the textarea
 * selection so they work even after a dialog steals focus.
 */
export function PromptToolbar({
  applyEdit,
  getSelection,
}: {
  applyEdit: ApplyEdit;
  getSelection: () => string;
}) {
  const [open, setOpen] = useState<"none" | "embedding" | "snippets">("none");

  return (
    <div className="relative mt-1 flex items-center gap-0.5 text-[var(--color-faint)]">
      <ToolBtn
        title="Decrease emphasis (Ctrl+↓)"
        onClick={() => applyEdit((t, s, e) => adjustWeight(t, s, e, -0.1))}
      >
        <Minus className="h-3 w-3" />
      </ToolBtn>
      <span className="select-none text-[10px] uppercase tracking-wide">weight</span>
      <ToolBtn
        title="Increase emphasis (Ctrl+↑)"
        onClick={() => applyEdit((t, s, e) => adjustWeight(t, s, e, 0.1))}
      >
        <Plus className="h-3 w-3" />
      </ToolBtn>

      <span className="mx-1 h-3 w-px bg-[var(--color-line)]" />

      <ToolBtn label title="Insert an embedding / textual inversion" onClick={() => setOpen("embedding")}>
        <Box className="h-3 w-3" />
        <span className="text-[10px]">embedding</span>
      </ToolBtn>
      <ToolBtn label title="Insert or save a prompt snippet" onClick={() => setOpen("snippets")}>
        <ScrollText className="h-3 w-3" />
        <span className="text-[10px]">snippets</span>
      </ToolBtn>

      <AnimatePresence>
        {open === "embedding" && (
          <EmbeddingPicker
            onPick={(name) => applyEdit((t, s, e) => insertToken(t, s, e, `embedding:${name}`))}
            onClose={() => setOpen("none")}
          />
        )}
      </AnimatePresence>

      {open === "snippets" && (
        <SnippetMenu
          getSelection={getSelection}
          onInsert={(text) => applyEdit((t, s, e) => insertToken(t, s, e, text))}
          onClose={() => setOpen("none")}
        />
      )}
    </div>
  );
}

function ToolBtn({
  children,
  title,
  label,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  label?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      // Keep the textarea's selection/caret intact when the tool is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-amber)]",
        label ? "text-[var(--color-muted)]" : "",
      )}
    >
      {children}
    </button>
  );
}

/** Reuses the model-browser dialog to pick an embedding; inserts `embedding:<name>`. */
function EmbeddingPicker({ onPick, onClose }: { onPick: (name: string) => void; onClose: () => void }) {
  const { data: models = [] } = useQuery({
    queryKey: ["models", "embedding"],
    queryFn: () => api.models("embedding"),
    staleTime: 60_000,
  });
  const options = models.map((m) => m.file);
  const byFile = new Map<string, ModelInfo>(models.map((m) => [m.file, m]));
  const embName = (file: string) => file.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return (
    <ModelPickerDialog
      kind="embedding"
      options={options}
      value=""
      byFile={byFile}
      onPick={(file) => {
        onPick(embName(file));
        onClose();
      }}
      onClose={onClose}
    />
  );
}

/** Small popover: insert a saved global snippet, save the current selection, or delete. */
function SnippetMenu({
  getSelection,
  onInsert,
  onClose,
}: {
  getSelection: () => string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: snippets = [] } = useQuery({
    queryKey: ["presets", "snippet"],
    queryFn: () => api.presets({ kind: "snippet" }),
  });
  const sel = getSelection().trim();

  async function saveSelection() {
    if (!sel) return;
    const name = await promptText({
      title: "Name this snippet",
      body: sel.length > 60 ? `${sel.slice(0, 60)}…` : sel,
      placeholder: "e.g. quality boost",
    });
    if (!name) return;
    await api.createPreset({ kind: "snippet", name, pipelineId: null, data: { text: sel } });
    qc.invalidateQueries({ queryKey: ["presets", "snippet"] });
  }
  async function remove(id: string) {
    await api.deletePreset(id);
    qc.invalidateQueries({ queryKey: ["presets", "snippet"] });
  }

  return (
    <>
      <div className="fixed inset-0 z-20" onMouseDown={onClose} />
      <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-64 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-elevated)] p-1 shadow-2xl">
        {snippets.map((s) => (
          <div
            key={s.id}
            className="group flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-[var(--color-line)]"
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onInsert(String(s.data.text ?? ""));
                onClose();
              }}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate text-[var(--color-text)]">{s.name}</div>
              <div className="truncate font-mono text-[10px] text-[var(--color-faint)]">
                {String(s.data.text ?? "")}
              </div>
            </button>
            <button
              type="button"
              onClick={() => remove(s.id)}
              title="Delete snippet"
              className="shrink-0 text-[var(--color-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {snippets.length === 0 && (
          <div className="px-2 py-2 text-center text-[11px] text-[var(--color-faint)]">
            No snippets yet.
          </div>
        )}
        <button
          type="button"
          disabled={!sel}
          onMouseDown={(e) => e.preventDefault()}
          onClick={saveSelection}
          className={cn(
            "mt-1 flex w-full items-center gap-1.5 border-t border-[var(--color-line)] px-2 py-1.5 text-[11px]",
            sel ? "text-[var(--color-amber)] hover:bg-[var(--color-line)]" : "cursor-default text-[var(--color-faint)]",
          )}
        >
          <Bookmark className="h-3 w-3" />
          {sel ? "Save selection as snippet" : "Select text to save a snippet"}
        </button>
      </div>
    </>
  );
}
