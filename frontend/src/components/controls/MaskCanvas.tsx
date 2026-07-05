import { useEffect, useRef, useState } from "react";
import { Upload, Eraser, Brush, Trash2, FlipHorizontal2, Loader2, Undo2, Redo2, ScanFace } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ParamValue } from "@latent/shared";

/**
 * Paint a black/white inpaint mask over a source image and upload it (white =
 * the area to regenerate). Feeds a ComfyUI `LoadImageMask` node.
 *
 * Editor: soft/hardness brush, erase, undo/redo, live brush cursor, invert,
 * clear. The mask lives on an offscreen canvas at the source's natural
 * resolution; pointer coords map through the on-screen rect so painting stays
 * aligned. History snapshots are taken after each stroke (not on load), capped.
 */
const HISTORY_CAP = 12;

export function MaskCanvas({
  value,
  onChange,
  sourceUrl,
  sourceName,
  blankSize,
}: {
  value: ParamValue;
  onChange: (v: ParamValue) => void;
  sourceUrl?: string;
  /** The source image's ComfyUI input filename — enables yolo auto-masking. */
  sourceName?: string;
  /** With no source image (e.g. txt2img regions), paint on a blank canvas of this size. */
  blankSize?: { w: number; h: number };
}) {
  const [src, setSrc] = useState<string | null>(sourceUrl ?? null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [brush, setBrush] = useState(40);
  const [hardness, setHardness] = useState(0.5);
  const [erase, setErase] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; d: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const maskRef = useRef<HTMLCanvasElement>(null); // natural-res, white-on-transparent
  const dispRef = useRef<HTMLCanvasElement>(null); // on-screen overlay mirror
  const wrapRef = useRef<HTMLDivElement>(null);
  const painting = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const hovering = useRef(false);
  const history = useRef<ImageData[]>([]);
  const histIndex = useRef(-1);

  useEffect(() => {
    if (sourceUrl) setSrc(sourceUrl);
  }, [sourceUrl]);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);

  // No source image (txt2img regions) → size the canvas to the requested blank size.
  const bw = blankSize?.w;
  const bh = blankSize?.h;
  useEffect(() => {
    if (!src && bw && bh) setDims({ w: bw, h: bh });
  }, [src, bw, bh]);

  // Size canvases to the image; reset history (empty base, no snapshot needed).
  useEffect(() => {
    if (!dims) return;
    for (const c of [maskRef.current, dispRef.current]) {
      if (c) {
        c.width = dims.w;
        c.height = dims.h;
      }
    }
    history.current = [];
    histIndex.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims]);

  /** Mirror the mask onto the visible overlay as a translucent red highlight. */
  function redraw() {
    const disp = dispRef.current;
    const mask = maskRef.current;
    if (!disp || !mask) return;
    const ctx = disp.getContext("2d")!;
    ctx.clearRect(0, 0, disp.width, disp.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "rgb(239,68,68)";
    ctx.fillRect(0, 0, disp.width, disp.height);
    ctx.globalCompositeOperation = "source-over";
  }

  function pushHistory() {
    const ctx = maskRef.current?.getContext("2d");
    if (!ctx || !dims) return;
    history.current = history.current.slice(0, histIndex.current + 1);
    history.current.push(ctx.getImageData(0, 0, dims.w, dims.h));
    if (history.current.length > HISTORY_CAP) history.current.shift();
    histIndex.current = history.current.length - 1;
    setCanUndo(histIndex.current >= 0); // index -1 = empty base; index 0 can undo back to it
    setCanRedo(false);
  }

  function restore(idx: number) {
    const ctx = maskRef.current?.getContext("2d");
    if (!ctx || !dims) return;
    if (idx < 0) ctx.clearRect(0, 0, dims.w, dims.h);
    else {
      const snap = history.current[idx];
      if (snap) ctx.putImageData(snap, 0, 0);
    }
    histIndex.current = idx;
    setCanUndo(idx >= 0);
    setCanRedo(idx < history.current.length - 1);
    redraw();
    void exportAndUpload();
  }
  // History holds post-stroke states; index -1 = the empty base.
  const undo = () => histIndex.current >= 0 && restore(histIndex.current - 1);
  const redo = () =>
    histIndex.current < history.current.length - 1 && restore(histIndex.current + 1);

  function toNatural(clientX: number, clientY: number) {
    const rect = dispRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * (dims?.w ?? 1),
      y: ((clientY - rect.top) / rect.height) * (dims?.h ?? 1),
    };
  }

  /** Stamp a soft (hardness-graded) round brush along the segment prev→to. */
  function stroke(from: { x: number; y: number } | null, to: { x: number; y: number }) {
    const ctx = maskRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    const r = brush / 2;
    const stamp = (x: number, y: number) => {
      const g = ctx.createRadialGradient(x, y, Math.max(0.01, r * hardness), x, y, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (!from) stamp(to.x, to.y);
    else {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const steps = Math.max(1, Math.floor(Math.hypot(dx, dy) / Math.max(1, r * 0.25)));
      for (let i = 1; i <= steps; i++) stamp(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    }
    ctx.globalCompositeOperation = "source-over";
    redraw();
  }

  function updateCursor(e: React.PointerEvent) {
    const wrap = wrapRef.current;
    const disp = dispRef.current;
    if (!wrap || !disp || !dims) return;
    const wr = wrap.getBoundingClientRect();
    const dr = disp.getBoundingClientRect();
    setCursor({ x: e.clientX - wr.left, y: e.clientY - wr.top, d: (brush * dr.width) / dims.w });
  }

  function onDown(e: React.PointerEvent) {
    if (!dims) return;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    painting.current = true;
    const p = toNatural(e.clientX, e.clientY);
    last.current = p;
    stroke(null, p);
  }
  function onMove(e: React.PointerEvent) {
    updateCursor(e);
    if (!painting.current) return;
    const p = toNatural(e.clientX, e.clientY);
    stroke(last.current, p);
    last.current = p;
  }
  function endStroke() {
    if (!painting.current) return;
    painting.current = false;
    last.current = null;
    pushHistory();
    void exportAndUpload();
  }

  function clearMask() {
    const ctx = maskRef.current?.getContext("2d");
    if (!ctx || !dims) return;
    ctx.clearRect(0, 0, dims.w, dims.h);
    pushHistory();
    redraw();
    // Upload the (now all-black) mask rather than an empty value — an empty
    // LoadImageMask errors in ComfyUI, whereas a black mask masks nothing (no-op).
    void exportAndUpload();
  }

  /** Fill a normalized [x0,y0,x1,y1] rectangle as the mask (soft edge), for split presets. */
  function preset(x0: number, y0: number, x1: number, y1: number) {
    const ctx = maskRef.current?.getContext("2d");
    if (!ctx || !dims) return;
    ctx.clearRect(0, 0, dims.w, dims.h);
    ctx.save();
    ctx.filter = `blur(${Math.max(2, Math.round(Math.min(dims.w, dims.h) * 0.02))}px)`; // soft boundary
    ctx.fillStyle = "white";
    ctx.fillRect(x0 * dims.w, y0 * dims.h, (x1 - x0) * dims.w, (y1 - y0) * dims.h);
    ctx.restore();
    pushHistory();
    redraw();
    void exportAndUpload();
  }

  /** Composite white-on-black (inverted on request), upload, store the filename. */
  async function exportAndUpload() {
    const mask = maskRef.current;
    if (!mask || !dims) return;
    const out = document.createElement("canvas");
    out.width = dims.w;
    out.height = dims.h;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, dims.w, dims.h);
    ctx.drawImage(mask, 0, 0);
    if (inverted) {
      ctx.globalCompositeOperation = "difference";
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, dims.w, dims.h);
      ctx.globalCompositeOperation = "source-over";
    }
    const base64 = out.toDataURL("image/png").split(",")[1] ?? "";
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadImage("latent-mask.png", base64, "image/png");
      onChange(res.subfolder ? `${res.subfolder}/${res.name}` : res.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mask upload failed (is ComfyUI running?)");
    } finally {
      setBusy(false);
    }
  }

  async function loadFile(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    setSrc(dataUrl);
  }

  /** Union a detection mask image (white = detected) into the current mask. */
  function applyMaskImage(img: ImageBitmap) {
    const ctx = maskRef.current?.getContext("2d");
    if (!ctx || !dims) return;
    const tmp = document.createElement("canvas");
    tmp.width = dims.w;
    tmp.height = dims.h;
    tmp.getContext("2d")!.drawImage(img, 0, 0, dims.w, dims.h);
    const det = tmp.getContext("2d")!.getImageData(0, 0, dims.w, dims.h).data;
    const cur = ctx.getImageData(0, 0, dims.w, dims.h);
    for (let i = 0; i < det.length; i += 4) {
      if (det[i]! > 128) {
        cur.data[i] = 255;
        cur.data[i + 1] = 255;
        cur.data[i + 2] = 255;
        cur.data[i + 3] = 255;
      }
    }
    ctx.putImageData(cur, 0, 0);
    pushHistory();
    redraw();
    void exportAndUpload();
  }

  /** Detect faces via the backend yolo endpoint and load the mask. */
  async function autoMask() {
    let name = sourceName;
    if (!name && src?.startsWith("data:")) {
      const base64 = src.split(",")[1] ?? "";
      const up = await api.uploadImage("automask-src.png", base64, "image/png");
      name = up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
    }
    if (!name) {
      setError("Load a source image first.");
      return;
    }
    setDetecting(true);
    setError(null);
    try {
      const res = await fetch("/api/automask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: name, detector: "face" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Detection failed");
      const bitmap = await createImageBitmap(await res.blob());
      applyMaskImage(bitmap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto-mask failed");
    } finally {
      setDetecting(false);
    }
  }

  // Keyboard undo/redo while hovering the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hovering.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!src && !blankSize) {
    return (
      <label className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-ink)] text-[var(--color-faint)] transition-colors hover:border-[var(--color-amber)]">
        <Upload className="h-5 w-5" />
        <span className="text-xs">Load an image to mask</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
          }}
        />
      </label>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        onPointerEnter={() => (hovering.current = true)}
        onPointerLeave={() => {
          hovering.current = false;
          setCursor(null);
        }}
        className="relative w-full touch-none overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)]"
      >
        {src ? (
          <img src={src} alt="" className="block w-full select-none" draggable={false} />
        ) : (
          <div
            className="w-full bg-[var(--color-elevated)]"
            style={{ aspectRatio: dims ? `${dims.w} / ${dims.h}` : "1 / 1" }}
          />
        )}
        <canvas ref={maskRef} className="hidden" />
        <canvas
          ref={dispRef}
          data-testid="mask-overlay"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          className="absolute inset-0 h-full w-full cursor-crosshair opacity-60"
        />
        {cursor && (
          <div
            className="pointer-events-none absolute rounded-full border border-white/80 mix-blend-difference"
            style={{
              left: cursor.x,
              top: cursor.y,
              width: cursor.d,
              height: cursor.d,
              transform: "translate(-50%, -50%)",
            }}
          />
        )}
        {busy && (
          <div className="absolute right-2 top-2 rounded bg-[var(--color-ink)]/80 p-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-amber)]" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-[var(--color-muted)]">
        <ToolBtn active={!erase} onClick={() => setErase(false)} title="Paint">
          <Brush className="h-3.5 w-3.5" /> Paint
        </ToolBtn>
        <ToolBtn active={erase} onClick={() => setErase(true)} title="Erase">
          <Eraser className="h-3.5 w-3.5" /> Erase
        </ToolBtn>
        <span className="h-3 w-px bg-[var(--color-line)]" />
        <ToolBtn onClick={undo} title="Undo (Ctrl+Z)" disabled={!canUndo}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn onClick={redo} title="Redo (Ctrl+Shift+Z)" disabled={!canRedo}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <span className="h-3 w-px bg-[var(--color-line)]" />
        <label className="flex items-center gap-1.5">
          size
          <input type="range" min={5} max={200} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="latent-range w-16" />
        </label>
        <label className="flex items-center gap-1.5">
          hard
          <input type="range" min={0} max={1} step={0.05} value={hardness} onChange={(e) => setHardness(Number(e.target.value))} className="latent-range w-14" />
        </label>
        <span className="h-3 w-px bg-[var(--color-line)]" />
        <ToolBtn active={inverted} onClick={() => setInverted((v) => !v)} title="Invert the mask on export">
          <FlipHorizontal2 className="h-3.5 w-3.5" /> Invert
        </ToolBtn>
        <ToolBtn onClick={clearMask} title="Clear the mask" danger>
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </ToolBtn>
        <button
          type="button"
          onClick={autoMask}
          disabled={detecting}
          title="Auto-mask detected faces (yolo)"
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-[var(--color-violet)] transition-colors hover:bg-[var(--color-elevated)] disabled:opacity-50"
        >
          {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanFace className="h-3.5 w-3.5" />}
          Auto-face
        </button>
      </div>

      {/* Split presets — one-click region masks (soft-edged) */}
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--color-faint)]">
        <span className="mr-0.5 uppercase tracking-wider">presets</span>
        {(
          [
            ["Left", [0, 0, 0.5, 1]],
            ["Right", [0.5, 0, 1, 1]],
            ["Top", [0, 0, 1, 0.5]],
            ["Bottom", [0, 0.5, 1, 1]],
            ["⅓ L", [0, 0, 0.34, 1]],
            ["⅓ M", [0.33, 0, 0.67, 1]],
            ["⅓ R", [0.66, 0, 1, 1]],
          ] as [string, [number, number, number, number]][]
        ).map(([label, [x0, y0, x1, y1]]) => (
          <button
            key={label}
            type="button"
            onClick={() => preset(x0, y0, x1, y1)}
            className="rounded border border-[var(--color-line)] px-1.5 py-0.5 text-[var(--color-muted)] transition-colors hover:border-[var(--color-amber)] hover:text-[var(--color-amber)]"
          >
            {label}
          </button>
        ))}
      </div>

      {value ? (
        <p className="truncate font-mono text-[10px] text-[var(--color-good)]">mask · {String(value)}</p>
      ) : (
        <p className="text-[10px] text-[var(--color-faint)]">Paint the area to regenerate (red).</p>
      )}
      {error && <p className="text-[10px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function ToolBtn({
  children,
  title,
  active,
  danger,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-1 transition-colors disabled:opacity-30",
        active ? "text-[var(--color-amber)]" : "hover:text-[var(--color-amber)]",
        danger && "hover:text-[var(--color-danger)]",
      )}
    >
      {children}
    </button>
  );
}
