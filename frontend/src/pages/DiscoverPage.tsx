import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Search, Loader2, Compass, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { CivitaiCard } from "@/components/CivitaiCard";
import { CivitaiDetail } from "@/components/CivitaiDetail";
import { cn } from "@/lib/utils";
import type { CivitaiModelResult, ModelKind } from "@latent/shared";

type Kind = ModelKind | "all";

const TYPES: { key: Kind; label: string }[] = [
  { key: "all", label: "All types" },
  { key: "checkpoint", label: "Checkpoints" },
  { key: "lora", label: "LoRAs" },
  { key: "diffusion", label: "Diffusion / UNet" },
  { key: "vae", label: "VAE" },
  { key: "upscale", label: "Upscalers" },
  { key: "controlnet", label: "ControlNet" },
  { key: "embedding", label: "Embeddings" },
];
const SORTS = [
  "Most Downloaded",
  "Highest Rated",
  "Most Liked",
  "Most Collected",
  "Most Discussed",
  "Most Images",
  "Newest",
  "Oldest",
];
const PERIODS = ["AllTime", "Year", "Month", "Week", "Day"];
const BASE_MODELS = [
  "Pony",
  "Illustrious",
  "NoobAI",
  "SDXL 1.0",
  "SD 1.5",
  "Flux.1 D",
  "SD 3.5",
  "Wan Video",
  "LTXV",
  "Hunyuan Video",
];

const DEFAULTS = { kind: "all" as Kind, sort: SORTS[0]!, period: "AllTime", nsfw: true };

export function DiscoverPage() {
  const [kind, setKind] = useState<Kind>(DEFAULTS.kind);
  const [sort, setSort] = useState(DEFAULTS.sort);
  const [period, setPeriod] = useState(DEFAULTS.period);
  const [baseModels, setBaseModels] = useState<string[]>([]);
  const [nsfw, setNsfw] = useState(DEFAULTS.nsfw);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [detail, setDetail] = useState<CivitaiModelResult | null>(null);

  const q = useInfiniteQuery({
    queryKey: ["civitai", kind, query, sort, period, baseModels, nsfw, username],
    queryFn: ({ pageParam }) =>
      api.civitaiSearch({
        query: query || undefined,
        kind,
        sort,
        period,
        baseModels,
        username: username ?? undefined,
        nsfw,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 60_000,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  // Open a creator "profile": filter to their models and clear the search box.
  const openCreator = (name: string) => {
    setUsername(name);
    setQuery("");
    setInput("");
    setDetail(null);
  };
  const creatorAvatar = username ? items.find((m) => m.authorImage)?.authorImage : undefined;

  const toggleBase = (b: string) =>
    setBaseModels((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));
  const reset = () => {
    setKind(DEFAULTS.kind);
    setSort(DEFAULTS.sort);
    setPeriod(DEFAULTS.period);
    setBaseModels([]);
    setNsfw(DEFAULTS.nsfw);
    setQuery("");
    setInput("");
    setUsername(null);
  };
  const dirty =
    kind !== DEFAULTS.kind ||
    sort !== DEFAULTS.sort ||
    period !== DEFAULTS.period ||
    baseModels.length > 0 ||
    nsfw !== DEFAULTS.nsfw ||
    query !== "" ||
    username !== null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader eyebrow="Library" title="Discover">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(input.trim());
          }}
          className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2.5"
        >
          <Search className="h-3.5 w-3.5 text-[var(--color-faint)]" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search Civitai…"
            className="h-9 w-44 bg-transparent text-sm outline-none placeholder:text-[var(--color-faint)] sm:w-72"
          />
        </form>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {/* Filter sidebar */}
        <aside className="w-52 shrink-0 space-y-5 overflow-y-auto border-r border-[var(--color-line)] p-4 md:w-60">
          <FilterGroup label="Type">
            {TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setKind(t.key)}
                className={cn(
                  "block w-full rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm transition-colors",
                  kind === t.key
                    ? "bg-[var(--color-elevated)] text-[var(--color-text)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-elevated)]/50 hover:text-[var(--color-text)]",
                )}
              >
                {t.label}
              </button>
            ))}
          </FilterGroup>

          <FilterGroup label="Sort by">
            <FilterSelect value={sort} onChange={setSort} options={SORTS} />
          </FilterGroup>

          <FilterGroup label="Period">
            <FilterSelect
              value={period}
              onChange={setPeriod}
              options={PERIODS}
              labels={{ AllTime: "All time" }}
            />
          </FilterGroup>

          <FilterGroup label="Base model">
            <div className="flex flex-wrap gap-1.5">
              {BASE_MODELS.map((b) => {
                const on = baseModels.includes(b);
                return (
                  <button
                    key={b}
                    onClick={() => toggleBase(b)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      on
                        ? "border-[var(--color-amber)] bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
                        : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
                    )}
                  >
                    {b}
                  </button>
                );
              })}
            </div>
          </FilterGroup>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-muted)]">Show NSFW</span>
            <Switch on={nsfw} onChange={setNsfw} />
          </div>

          {dirty && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-amber)]"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset filters
            </button>
          )}
        </aside>

        {/* Results */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          {username && (
            <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
              {creatorAvatar ? (
                <img src={creatorAvatar} alt="" className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--color-elevated)] text-sm font-semibold text-[var(--color-muted)]">
                  {username.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-widest text-[var(--color-faint)]">Creator</div>
                <div className="truncate text-sm font-semibold text-[var(--color-text)]">{username}</div>
              </div>
              <a
                href={`https://civitai.com/user/${encodeURIComponent(username)}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-amber)]"
              >
                View on Civitai
              </a>
              <button
                onClick={() => setUsername(null)}
                className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                Clear
              </button>
            </div>
          )}
          {q.isError ? (
            <div className="py-20 text-center text-sm text-[var(--color-danger)]">
              Couldn't reach Civitai. Try again in a moment.
            </div>
          ) : q.isLoading ? (
            <div className="flex justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-faint)]" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center text-[var(--color-muted)]">
              <Compass className="h-7 w-7 text-[var(--color-faint)]" strokeWidth={1.5} />
              <p className="text-sm">No results — loosen the filters or try a different search.</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2 text-xs text-[var(--color-faint)]">
                {items.length} result{items.length === 1 ? "" : "s"} loaded
                {q.isFetching && !q.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {items.map((m) => (
                  <CivitaiCard key={m.id} model={m} onOpen={() => setDetail(m)} onCreator={openCreator} />
                ))}
              </div>
              {q.hasNextPage && (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={() => q.fetchNextPage()}
                    disabled={q.isFetchingNextPage}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-4 py-2 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-50"
                  >
                    {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {detail && (
          <CivitaiDetail model={detail} onClose={() => setDetail(null)} onCreator={openCreator} />
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-faint)]">{label}</div>
      {children}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  labels,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2 text-sm outline-none focus:border-[var(--color-amber)]"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors",
        on ? "bg-[var(--color-amber)]" : "bg-[var(--color-elevated)]",
      )}
    >
      <span
        className={cn(
          "inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[20px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}
