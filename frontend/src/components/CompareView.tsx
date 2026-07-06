import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { X, Columns2, SlidersHorizontal, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { cn, seedFingerprint } from "@/lib/utils";
import type { GenerationRecord } from "@latent/shared";

type Mode = "split" | "slider";

const ZMIN = 1;
const ZMAX = 8;
const ZSTEP = 0.4;

/** Side-by-side / before-after comparison of two generations, with a param diff. */
export function CompareView({
  a,
  b,
  onClose,
}: {
  a: GenerationRecord;
  b: GenerationRecord;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("split");
  const aUrl = a.outputs[0]?.url;
  const bUrl = b.outputs[0]?.url;
  const diffs = paramDiffs(a, b);

  // Shared zoom/pan — applied to BOTH images so you inspect the same region in each.
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const zoomTo = useCallback((next: number) => {
    const s = Math.min(ZMAX, Math.max(ZMIN, Math.round(next * 100) / 100));
    setScale(s);
    if (s === ZMIN) setPos({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomTo(scale + ZSTEP);
      else if (e.key === "-" || e.key === "_") zoomTo(scale - ZSTEP);
      else if (e.key === "0") zoomTo(ZMIN);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, scale, zoomTo]);

  const zoomed = scale > ZMIN;
  const imgStyle: CSSProperties = {
    transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
    transition: dragging ? "none" : "transform 0.12s ease-out",
  };
  function onWheel(e: React.WheelEvent) {
    zoomTo(scale + (e.deltaY < 0 ? ZSTEP : -ZSTEP));
  }
  function onPointerDown(e: React.PointerEvent) {
    if (!zoomed) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setPos({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
  }
  function onPointerUp() {
    drag.current = null;
    setDragging(false);
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/50 p-1">
          <ModeBtn active={mode === "split"} onClick={() => setMode("split")} icon={<Columns2 className="h-4 w-4" />}>
            Side by side
          </ModeBtn>
          <ModeBtn active={mode === "slider"} onClick={() => setMode("slider")} icon={<SlidersHorizontal className="h-4 w-4" />}>
            Slider
          </ModeBtn>
        </div>
        <div className="flex items-center gap-2">
          {/* Shared zoom — wheel over either image, or these controls */}
          <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-black/50 px-1 py-1">
            <ZoomBtn label="Zoom out" onClick={() => zoomTo(scale - ZSTEP)} disabled={!zoomed}>
              <ZoomOut className="h-4 w-4" />
            </ZoomBtn>
            <button
              onClick={() => zoomTo(ZMIN)}
              className="min-w-[3rem] rounded-md px-1.5 py-1 text-center font-mono text-[11px] text-white/80 hover:bg-white/10"
              title="Reset zoom (0)"
            >
              {Math.round(scale * 100)}%
            </button>
            <ZoomBtn label="Zoom in" onClick={() => zoomTo(scale + ZSTEP)} disabled={scale >= ZMAX}>
              <ZoomIn className="h-4 w-4" />
            </ZoomBtn>
            <ZoomBtn label="Fit" onClick={() => zoomTo(ZMIN)} disabled={!zoomed}>
              <Maximize className="h-4 w-4" />
            </ZoomBtn>
          </div>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/60 text-white/80 transition-colors hover:bg-black/80 hover:text-white"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Stage — wheel zooms both; drag pans both (split mode). */}
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center px-5 pb-3",
          mode === "split" && zoomed && (dragging ? "cursor-grabbing" : "cursor-grab"),
        )}
        onWheel={onWheel}
        onPointerDown={mode === "split" ? onPointerDown : undefined}
        onPointerMove={mode === "split" ? onPointerMove : undefined}
        onPointerUp={mode === "split" ? onPointerUp : undefined}
        onDoubleClick={mode === "split" ? () => zoomTo(zoomed ? ZMIN : 2.5) : undefined}
      >
        {mode === "split" ? (
          <div className="grid h-full w-full max-w-6xl grid-cols-2 gap-3">
            <Pane url={aUrl} label={`A · ${seedFingerprint(a.seed)}`} imgStyle={imgStyle} />
            <Pane url={bUrl} label={`B · ${seedFingerprint(b.seed)}`} imgStyle={imgStyle} />
          </div>
        ) : (
          <SliderCompare aUrl={aUrl} bUrl={bUrl} imgStyle={imgStyle} />
        )}
      </div>

      {/* Param diff */}
      {diffs.length > 0 && (
        <div className="max-h-[26vh] shrink-0 overflow-y-auto border-t border-white/10 bg-black/40 px-5 py-3">
          <div className="mx-auto grid max-w-3xl grid-cols-[minmax(6rem,auto)_1fr_1fr] gap-x-4 gap-y-1.5 text-xs">
            <div className="text-[10px] font-medium uppercase tracking-widest text-white/40">Setting</div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-amber)]">A</div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-violet)]">B</div>
            {diffs.map((d) => (
              <Row key={d.key} label={d.label} av={d.a} bv={d.b} />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Pane({ url, label, imgStyle }: { url?: string; label: string; imgStyle?: CSSProperties }) {
  return (
    <figure className="flex min-h-0 flex-col items-center gap-2">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-white/10">
        {url ? (
          <img src={url} alt={label} draggable={false} className="max-h-full max-w-full select-none object-contain" style={imgStyle} />
        ) : (
          <div className="grid h-40 w-full place-items-center text-xs text-white/40">No image</div>
        )}
      </div>
      <figcaption className="font-mono text-[11px] text-white/60">{label}</figcaption>
    </figure>
  );
}

function ZoomBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function SliderCompare({ aUrl, bUrl, imgStyle }: { aUrl?: string; bUrl?: string; imgStyle?: CSSProperties }) {
  const [pct, setPct] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function setFromClientX(clientX: number) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPct(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }

  return (
    <div
      ref={ref}
      className="relative max-h-full max-w-5xl select-none overflow-hidden rounded-[var(--radius-lg)] border border-white/10"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && setFromClientX(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
    >
      {/* B is the base layer; A is clipped to the left of the divider */}
      {bUrl && <img src={bUrl} alt="B" draggable={false} className="block max-h-[70vh] w-auto object-contain" style={imgStyle} />}
      {aUrl && (
        <img
          src={aUrl}
          alt="A"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ ...imgStyle, clipPath: `inset(0 ${100 - pct}% 0 0)` }}
        />
      )}
      {/* Divider */}
      <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white/80" style={{ left: `${pct}%` }}>
        <div className="absolute top-1/2 left-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-black/70">
          <SlidersHorizontal className="h-3.5 w-3.5 text-white" />
        </div>
      </div>
      <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-amber)]">A</span>
      <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-violet)]">B</span>
    </div>
  );
}

function Row({ label, av, bv }: { label: string; av: string; bv: string }) {
  return (
    <>
      <div className="truncate text-white/50">{label}</div>
      <div className="break-words text-white/90">{av || "—"}</div>
      <div className="break-words text-white/90">{bv || "—"}</div>
    </>
  );
}

function ModeBtn({
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
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
        active ? "bg-white/15 text-white" : "text-white/60 hover:text-white",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Param diff ────────────────────────────────────────────────────────────────

function fmtVal(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    // LoRA stacks → "name @strength" list; other arrays → joined.
    const loras = value.filter((v) => v && typeof v === "object" && "lora" in (v as object));
    if (loras.length) {
      return (loras as { on: boolean; lora: string; strength: number }[])
        .filter((l) => l.on)
        .map((l) => `${baseName(l.lora)} @${l.strength}`)
        .join(", ");
    }
    return value.map(String).join(", ");
  }
  const s = String(value);
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

function baseName(f: string): string {
  return f.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? f;
}

function keyLabel(key: string): string {
  // Param keys look like "<nodeId>.<input>" — show the input, humanized.
  const input = key.split(".").pop() ?? key;
  return input.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function paramDiffs(a: GenerationRecord, b: GenerationRecord) {
  const keys = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  const out: { key: string; label: string; a: string; b: string }[] = [];
  for (const key of keys) {
    const av = fmtVal(a.params[key]);
    const bv = fmtVal(b.params[key]);
    if (av !== bv) out.push({ key, label: keyLabel(key), a: av, b: bv });
  }
  // Stable, readable order: shorter labels (scalars like seed/steps) first.
  return out.sort((x, y) => x.a.length + x.b.length - (y.a.length + y.b.length));
}
