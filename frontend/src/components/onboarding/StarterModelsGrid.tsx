import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Check, Loader2, Image as ImageIcon, Film, Star, Box, KeyRound } from "lucide-react";
import { api } from "@/lib/api";
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
  "WAN 2.2 video",
  "WAN 2.2 video — optional",
];

/** The onboarding "Models" step: a checkpoint menu grouped by style + support + WAN. */
export function StarterModelsGrid() {
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
  for (const m of models) {
    const arr = byCat.get(m.category) ?? [];
    arr.push(m);
    byCat.set(m.category, arr);
  }
  const cats = CATEGORY_ORDER.filter((c) => byCat.has(c));

  return (
    <div className="space-y-5">
      <CivitaiKeyBanner />
      {(["illustrious", "wan"] as const).map((pack) => {
        const packCats = cats.filter((c) => (byCat.get(c) ?? [])[0]?.pack === pack);
        if (!packCats.length) return null;
        const PackIcon = pack === "wan" ? Film : ImageIcon;
        return (
          <div key={pack} className="space-y-3">
            <div className="flex items-center gap-2 border-b border-[var(--color-line)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              <PackIcon className="h-3.5 w-3.5 text-[var(--color-amber)]" />
              {pack === "wan" ? "WAN 2.2 — video" : "Illustrious — image"}
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
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useWs((s) => (jobId ? s.downloads[jobId] : undefined));
  const installed = model.installed || job?.status === "completed";
  const status = job?.status;
  const pct = job && job.total ? Math.round((job.received / job.total) * 100) : 0;
  const gb = model.sizeBytes ? (model.sizeBytes / 1_073_741_824).toFixed(1) : null;

  async function download() {
    try {
      const j =
        model.source.type === "civitai"
          ? await api.startDownload(model.source.modelId, model.source.versionId)
          : await api.startUrlDownload({
              url: model.source.url,
              folder: model.folder,
              filename: model.filename,
              kind: model.kind,
              name: model.label,
              sizeBytes: model.sizeBytes,
              headers: model.source.headers,
            });
      setJobId(j.id);
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

/** Inline Civitai API-key field — most checkpoints download from Civitai, which
 *  needs a (free) key for NSFW/gated models. Saved to app settings immediately. */
function CivitaiKeyBanner() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings?.civitaiApiKey) setKey(settings.civitaiApiKey);
  }, [settings]);

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
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Civitai API key"
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
