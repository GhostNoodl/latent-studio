import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Braces } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { adjustWeight, type EditResult } from "@/lib/promptEdit";
import { PromptToolbar } from "@/components/controls/PromptToolbar";
import type { TagSuggestion } from "@latent/shared";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  /** Param key — enables a "recent prompts" history dropdown for this field. */
  historyKey?: string;
  /** Show the prompt toolbar (weighting / embeddings / snippets). Default true. */
  tools?: boolean;
}

// Booru category → accent color.
const CATEGORY_COLOR: Record<number, string> = {
  1: "var(--color-amber)", // artist
  3: "var(--color-violet)", // copyright
  4: "var(--color-good)", // character
};

/** Format a booru tag for insertion: underscores→spaces, escape weighting parens. */
function formatTag(name: string): string {
  return name.replace(/_/g, " ").replace(/([()])/g, "\\$1");
}

/** The comma/newline-delimited token the caret currently sits in. */
function tokenAt(text: string, caret: number): { start: number; token: string } {
  const before = text.slice(0, caret);
  const start = Math.max(before.lastIndexOf(","), before.lastIndexOf("\n")) + 1;
  return { start, token: before.slice(start).trimStart() };
}

/**
 * If the caret sits inside an unclosed `__wildcard` (odd number of `__`
 * delimiters before it), return where it starts + what's been typed so far.
 * The trailing text must still be a valid partial name (word chars / `-` / `/`).
 */
function wildcardAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const doubles = before.match(/__/g);
  if (!doubles || doubles.length % 2 === 0) return null; // no open __
  const start = before.lastIndexOf("__");
  const query = before.slice(start + 2);
  if (!/^[A-Za-z0-9_\-/]*$/.test(query)) return null; // caret moved past the name
  return { start, query };
}

export function TagAutocomplete({ value, onChange, placeholder, rows = 3, historyKey, tools = true }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"tags" | "wildcard">("tags");
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const caretToApply = useRef<{ start: number; end: number } | null>(null);
  const wcStart = useRef(0);
  /** Last known selection, so toolbar actions work after a dialog steals focus. */
  const lastSel = useRef({ start: 0, end: 0 });

  const { data: suggestions = [] } = useQuery({
    queryKey: ["tags", query],
    queryFn: () => api.tags(query),
    enabled: open && mode === "tags" && query.length >= 2,
    staleTime: 60_000,
  });

  // All wildcard names (small list) — filtered client-side as the user types.
  const { data: allWildcards = [] } = useQuery({
    queryKey: ["wildcards"],
    queryFn: api.wildcards,
    staleTime: 30_000,
  });
  const wildcardMatches = useMemo(() => {
    if (mode !== "wildcard") return [];
    const q = query.toLowerCase();
    return allWildcards
      .filter((w) => w.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b);
      })
      .slice(0, 20);
  }, [mode, query, allWildcards]);

  // Recent distinct prompts for this field (from the gallery).
  const { data: generations = [] } = useQuery({
    queryKey: ["generations"],
    queryFn: () => api.generations({ limit: 200 }),
    enabled: Boolean(historyKey),
  });
  const history = useMemo(() => {
    if (!historyKey) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const g of generations) {
      const v = g.params[historyKey];
      if (typeof v === "string" && v.trim() && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
      if (out.length >= 12) break;
    }
    return out;
  }, [generations, historyKey]);

  // Apply a pending selection/caret after a controlled-value update.
  useEffect(() => {
    if (caretToApply.current != null && ref.current) {
      ref.current.selectionStart = caretToApply.current.start;
      ref.current.selectionEnd = caretToApply.current.end;
      lastSel.current = caretToApply.current;
      caretToApply.current = null;
    }
  });

  function refreshQuery() {
    const el = ref.current;
    if (!el) return;
    // Wildcard context wins — an open `__` is unambiguous.
    const wc = wildcardAt(el.value, el.selectionStart);
    if (wc) {
      wcStart.current = wc.start;
      setMode("wildcard");
      setQuery(wc.query);
      setOpen(true);
      setActive(0);
      return;
    }
    const { token } = tokenAt(el.value, el.selectionStart);
    setMode("tags");
    setQuery(token);
    setOpen(token.length >= 2);
    setActive(0);
  }

  function acceptTag(s: TagSuggestion) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const { start } = tokenAt(value, caret);
    const insert = `${formatTag(s.name)}, `;
    const next = value.slice(0, start) + insert + value.slice(caret);
    const pos = start + insert.length;
    caretToApply.current = { start: pos, end: pos };
    onChange(next);
    setOpen(false);
    el.focus();
  }

  function acceptWildcard(name: string) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const insert = `__${name}__`;
    const next = value.slice(0, wcStart.current) + insert + value.slice(caret);
    const pos = wcStart.current + insert.length;
    caretToApply.current = { start: pos, end: pos };
    onChange(next);
    setOpen(false);
    el.focus();
  }

  /** Run a pure text edit against the current (or last-known) selection + restore it. */
  function applyEdit(edit: (text: string, start: number, end: number) => EditResult) {
    const el = ref.current;
    if (!el) return;
    const focused = document.activeElement === el;
    const start = focused ? el.selectionStart : lastSel.current.start;
    const end = focused ? el.selectionEnd : lastSel.current.end;
    const res = edit(value, start, end);
    caretToApply.current = { start: res.selStart, end: res.selEnd };
    onChange(res.text);
    el.focus();
  }

  const getSelection = () => value.slice(lastSel.current.start, lastSel.current.end);

  const listLen = mode === "wildcard" ? wildcardMatches.length : suggestions.length;

  function acceptActive() {
    if (mode === "wildcard") {
      const name = wildcardMatches[active];
      if (name) acceptWildcard(name);
    } else {
      const s = suggestions[active];
      if (s) acceptTag(s);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/Cmd + ↑/↓ bumps A1111 emphasis on the selection/token — works whether
    // or not the autocomplete dropdown is open, so handle it before the guard.
    if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      applyEdit((t, s, en) => adjustWeight(t, s, en, e.key === "ArrowUp" ? 0.1 : -0.1));
      return;
    }
    if (!open || listLen === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % listLen);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + listLen) % listLen);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      acceptActive();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showTags = open && mode === "tags" && suggestions.length > 0;
  const showWildcards = open && mode === "wildcard" && wildcardMatches.length > 0;

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(refreshQuery);
        }}
        onKeyDown={onKeyDown}
        onClick={refreshQuery}
        onSelect={(e) => {
          const t = e.currentTarget;
          lastSel.current = { start: t.selectionStart, end: t.selectionEnd };
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 py-2 pr-8 text-sm leading-relaxed text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)] focus:outline-none"
      />

      {/* History toggle */}
      {history.length > 0 && (
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          title="Recent prompts"
          className="absolute right-2 top-2 text-[var(--color-faint)] hover:text-[var(--color-amber)]"
        >
          <History className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Tag suggestions */}
      {showTags && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-elevated)] shadow-2xl">
          {suggestions.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                acceptTag(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs",
                i === active ? "bg-[var(--color-line)]" : "",
              )}
            >
              <span className="truncate">
                <span style={{ color: CATEGORY_COLOR[s.category] ?? "var(--color-text)" }}>
                  {s.name.replace(/_/g, " ")}
                </span>
                {s.alias && <span className="ml-1.5 text-[var(--color-faint)]">← {s.alias}</span>}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
                {formatCount(s.count)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Wildcard suggestions (triggered by an open `__`) */}
      {showWildcards && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-elevated)] shadow-2xl">
          {wildcardMatches.map((name, i) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                acceptWildcard(name);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                i === active ? "bg-[var(--color-line)]" : "",
              )}
            >
              <Braces className="h-3 w-3 shrink-0 text-[var(--color-violet)]" />
              <span className="truncate font-mono text-[var(--color-text)]">{name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
                __{name}__
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Prompt history */}
      {showHistory && history.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-elevated)] shadow-2xl">
          {history.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => {
                onChange(h);
                setShowHistory(false);
              }}
              className="block w-full truncate px-3 py-1.5 text-left text-xs text-[var(--color-muted)] hover:bg-[var(--color-line)] hover:text-[var(--color-text)]"
            >
              {h}
            </button>
          ))}
        </div>
      )}

      {tools && <PromptToolbar applyEdit={applyEdit} getSelection={getSelection} />}
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
