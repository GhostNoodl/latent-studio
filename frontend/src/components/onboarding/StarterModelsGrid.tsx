import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Check, Loader2, Image as ImageIcon, Film, Music2, Star, Box, KeyRound, Tags } from "lucide-react";
import { api } from "@/lib/api";
import { startStarterModel, startStarterPack } from "@/lib/starterDownloads";
import { useWs } from "@/lib/ws";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { StarterModelState } from "@latent/shared";

const CATEGORY_ORDER = [
  "Anime — all-rounders",
  "Semi-real (2.5D)",
  "Realism",
  "Furry — 2D / cartoon",
  "Furry — realistic",
  "Support & extras",
  "Krea 2 image",
  "LTX 2.3 video",
  "LTX 2.3 video — optional",
  "MiniMax H3 video",
  "MiniMax Music 3",
  "MiniMax Music 3 — optional",
];

/** The onboarding "Models" step: a checkpoint menu grouped by style + support + LTX. */
export function StarterModelsGrid() {
  const queryClient = useQueryClient();
  const [startingPack, setStartingPack] = useState<string | null>(null);
  const { data: models = [], isLoading } = useQuery({
    queryKey: ["starter-models"],
    queryFn: api.starterModels,
    refetchInterval: 4000, // reflect newly-installed models as downloads finish
  });

  if (isLoading) {
    return <div className="grid place-items-center py-10 text-sm text-[var(--color-faint)]">Loading suggested models…</div>;
  }

  // Group by category, in a defined order; recommended tiles first within a group.
  const byCat = new Map<string, StarterModelState[]>();
  for (const m of models.filter((model) => model.onboarding !== false)) {
    const arr = byCat.get(m.category) ?? [];
    arr.push(m);
    byCat.set(m.category, arr);
  }
  const cats = CATEGORY_ORDER.filter((c) => byCat.has(c));

  async function downloadRecommendedPack(pack: StarterModelState["pack"], items: StarterModelState[]) {
    const missing = items.filter((model) => model.recommended && !model.installed);
    if (!missing.length) return;
    setStartingPack(pack);
    try {
      await startStarterPack(missing);
      await queryClient.invalidateQueries({ queryKey: ["starter-models"] });
    } finally {
      setStartingPack(null);
    }
  }

  return (
    <div className="space-y-5">
      <CivitaiKeyBanner />
      <TagsTile />
      {(["illustrious", "krea2", "ltx", "h3", "music3"] as const).map((pack) => {
        const packCats = cats.filter((c) => (byCat.get(c) ?? [])[0]?.pack === pack);
        if (!packCats.length) return null;
        const packItems = packCats.flatMap((cat) => byCat.get(cat) ?? []);
        const missingRecommended = packItems.filter((model) => model.recommended && !model.installed);
        const PackIcon = pack === "illustrious" || pack === "krea2" ? ImageIcon : pack === "music3" ? Music2 : Film;
        const license = packItems.find((model) => model.license)?.license;
        return (
          <div key={pack} className="space-y-3">
            <div className="flex items-center gap-2 border-b border-[var(--color-line)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              <PackIcon className="h-3.5 w-3.5 shrink-0 text-[var(--color-amber)]" />
              <span className="flex-1">
                {pack === "illustrious"
                  ? "Image"
                  : pack === "krea2"
                    ? "Krea 2 — image"
                  : pack === "ltx"
                    ? "LTX 2.3 — video"
                    : pack === "h3"
                      ? "MiniMax H3 — video"
                      : "MiniMax Music 3 — audio"}
              </span>
              {license && (
                <a
                  href={license.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] normal-case tracking-normal text-[var(--color-muted)] hover:text-[var(--color-amber)] hover:underline"
                >
                  License
                </a>
              )}
              {(pack === "music3" || pack === "krea2") && missingRecommended.length > 0 && (
                <button
                  type="button"
                  disabled={startingPack === pack}
                  onClick={() => downloadRecommendedPack(pack, packItems)}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--color-amber)]/40 px-2.5 py-1 text-[10px] normal-case tracking-normal text-[var(--color-amber)] transition-colors hover:bg-[var(--color-amber)]/10 disabled:opacity-50"
                >
                  {startingPack === pack ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Get recommended pack
                </button>
              )}
            </div>
            {packCats.map((cat) => {
              const items = (byCat.get(cat) ?? []).slice().sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
              return (
                <div key={cat} className="space-y-1.5">
                  <div className="text-[11px] font-medium text-[var(--color-faint)]">{cat}</div>
                  {items.map((m) => (
                    <StarterTile key={m.id} model={m} />
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function StarterTile({ model }: { model: StarterModelState }) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useWs((s) =>
    jobId
      ? s.downloads[jobId]
      : Object.values(s.downloads).find((candidate) => candidate.name === model.label),
  );
  const installed = model.installed || job?.status === "completed";
  const status = job?.status;
  const pct = job && job.total ? Math.round((job.received / job.total) * 100) : 0;
  const gb = model.sizeBytes ? (model.sizeBytes / 1_073_741_824).toFixed(1) : null;

  useEffect(() => {
    if (status === "completed") {
      queryClient.invalidateQueries({ queryKey: ["starter-models"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    }
  }, [status, queryClient]);

  async function download() {
    try {
      const j = await startStarterModel(model);
      if (j) setJobId(j.id);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-ink)] p-2">
      {/* thumbnail */}
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--color-surface)]">
        {model.previewUrl ? (
          <img src={model.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-[var(--color-faint)]">
            <Box className="h-4 w-4" strokeWidth={1.25} />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-[var(--color-text)]">{model.label}</span>
          {model.recommended && <Star className="h-3 w-3 shrink-0 text-[var(--color-amber)]" fill="currentColor" />}
          {gb && <span className="shrink-0 text-[10px] text-[var(--color-faint)]">{gb} GB</span>}
          {model.nsfw && <Badge tone="neutral">18+</Badge>}
        </div>
        <div className="truncate text-[11px] text-[var(--color-muted)]">{model.description}</div>
        {model.license && (
          <a
            href={model.license.url}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-[var(--color-amber)] hover:underline"
          >
            {model.license.name}
          </a>
        )}
        {status === "failed" && job?.error && (
          <div className="truncate text-[10px] text-[var(--color-danger)]" title={job.error}>
            {job.error}
          </div>
        )}
      </div>

      {installed ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-good)]/15 px-2.5 py-1.5 text-xs text-[var(--color-good)]">
          <Check className="h-3.5 w-3.5" /> Installed
        </span>
      ) : (
        <button
          onClick={download}
          disabled={status === "downloading"}
          className={cn(
            "relative flex h-8 w-24 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-sm)] text-xs font-medium transition-colors",
            status === "failed"
              ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
              : "bg-[var(--color-elevated)] text-[var(--color-text)] hover:bg-[var(--color-amber)] hover:text-[var(--color-on-amber)] disabled:opacity-100",
          )}
        >
          {status === "downloading" && (
            <span className="absolute inset-y-0 left-0 bg-[var(--color-amber)]/25" style={{ width: `${pct}%` }} />
          )}
          <span className="relative flex items-center gap-1.5">
            {status === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {pct}%
              </>
            ) : status === "failed" ? (
              "Retry"
            ) : (
              <>
                <Download className="h-3.5 w-3.5" /> Get
              </>
            )}
          </span>
        </button>
      )}
    </div>
  );
}

/** Prompt-autocomplete tag database — fresh installs don't ship the ~6 MB booru CSV,
 *  so offer to download it here. Without it, prompt autocomplete silently shows nothing. */
function TagsTile() {
  const { data: status } = useQuery({
    queryKey: ["tags-status"],
    queryFn: api.tagsStatus,
    refetchInterval: 4000,
  });
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useWs((s) => (jobId ? s.downloads[jobId] : undefined));
  const installed = status?.installed || job?.status === "completed";
  const st = job?.status;
  const pct = job && job.total ? Math.round((job.received / job.total) * 100) : 0;

  async function download() {
    try {
      const j = await api.downloadTags();
      setJobId(j.id);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-ink)] p-2">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-xs)] bg-[var(--color-surface)] text-[var(--color-amber)]">
        <Tags className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-[var(--color-text)]">Prompt autocomplete</span>
          <Star className="h-3 w-3 shrink-0 text-[var(--color-amber)]" fill="currentColor" />
          <span className="shrink-0 text-[10px] text-[var(--color-faint)]">6 MB</span>
        </div>
        <div className="truncate text-[11px] text-[var(--color-muted)]">
          Booru tag suggestions (Danbooru + e621) as you type prompts.
        </div>
      </div>

      {installed ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-good)]/15 px-2.5 py-1.5 text-xs text-[var(--color-good)]">
          <Check className="h-3.5 w-3.5" /> Installed
        </span>
      ) : (
        <button
          onClick={download}
          disabled={st === "downloading"}
          className={cn(
            "relative flex h-8 w-24 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-sm)] text-xs font-medium transition-colors",
            st === "failed"
              ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
              : "bg-[var(--color-elevated)] text-[var(--color-text)] hover:bg-[var(--color-amber)] hover:text-[var(--color-on-amber)] disabled:opacity-100",
          )}
        >
          {st === "downloading" && (
            <span className="absolute inset-y-0 left-0 bg-[var(--color-amber)]/25" style={{ width: `${pct}%` }} />
          )}
          <span className="relative flex items-center gap-1.5">
            {st === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {pct}%
              </>
            ) : st === "failed" ? (
              "Retry"
            ) : (
              <>
                <Download className="h-3.5 w-3.5" /> Get
              </>
            )}
          </span>
        </button>
      )}
    </div>
  );
}

/** Inline Civitai API-key field — most checkpoints download from Civitai, which
 *  needs a (free) key for NSFW/gated models. Saved to app settings immediately. */
function CivitaiKeyBanner() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    await api.saveSettings({ civitaiApiKey: key.trim() });
    setSaved(true);
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
        <KeyRound className="h-3.5 w-3.5 text-[var(--color-amber)]" /> Civitai API key
        <span className="font-normal text-[var(--color-faint)]">(needed for most checkpoints)</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
        Checkpoints download from Civitai, which requires a free API key for NSFW/gated models. Paste
        yours here (or set it later in Settings).{" "}
        <a
          href="https://civitai.com/user/account/keys"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-amber)] hover:underline"
        >
          Get a key →
        </a>
      </p>
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Civitai API key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={settings?.hasCivitaiApiKey ? "Key saved — paste a replacement" : "Civitai API key"}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-2.5 py-1.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)] focus:outline-none"
        />
        <button
          type="button"
          onClick={save}
          className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-amber)]"
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </div>
  );
}
