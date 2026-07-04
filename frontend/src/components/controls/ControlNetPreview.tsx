import { useEffect, useRef, useState } from "react";
import { Loader2, Eye } from "lucide-react";

/**
 * Live control-map preview for a ControlNet preprocessor: runs the selected
 * preprocessor over the reference image (debounced) and shows the result — the
 * canny edges / depth map / pose skeleton that will guide generation — so the
 * user can see it before committing to a full run.
 */
export function ControlNetPreview({
  preprocessor,
  imageName,
  resolution,
}: {
  preprocessor: string;
  imageName?: string;
  resolution?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastKey = useRef("");

  useEffect(() => {
    if (!imageName || !preprocessor || preprocessor === "none") {
      setUrl(null);
      return;
    }
    const key = `${imageName}|${preprocessor}|${resolution ?? 512}`;
    if (key === lastKey.current) return;
    const timer = setTimeout(async () => {
      lastKey.current = key;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/cn-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: imageName, preprocessor, resolution: resolution ?? 512 }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Preview failed");
        const blob = await res.blob();
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Preview failed");
      } finally {
        setBusy(false);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [imageName, preprocessor, resolution]);

  // Release the last object URL on unmount.
  useEffect(() => () => setUrl((prev) => (prev ? (URL.revokeObjectURL(prev), null) : null)), []);

  if (preprocessor === "none") return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-[var(--color-faint)]">
        <Eye className="h-3 w-3" /> Control map
        {busy && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-amber)]" />}
      </div>
      <div className="relative grid min-h-[6rem] place-items-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)]">
        {url ? (
          <img src={url} alt="control map preview" className="block max-h-64 w-full object-contain" />
        ) : (
          <span className="px-2 py-6 text-center text-[11px] text-[var(--color-faint)]">
            {busy
              ? "Preprocessing…"
              : error
                ? ""
                : imageName
                  ? "Preview will appear here"
                  : "Add a reference image to preview"}
          </span>
        )}
      </div>
      {error && <p className="text-[10px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
