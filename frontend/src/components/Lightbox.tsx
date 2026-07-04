import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ZoomIn, ZoomOut, Maximize, Download, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN = 1; // fit-to-screen — can't zoom out past this
const MAX = 6;
const STEP = 0.35;

/**
 * Fullscreen image viewer: zoom (wheel / buttons / keys), pan when zoomed,
 * download + open-in-tab. Zoom-out is clamped to fit (MIN = 1) so the image
 * never shrinks below the screen.
 */
export function Lightbox({
  src,
  filename,
  onClose,
}: {
  src: string;
  filename?: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const zoomTo = useCallback((next: number) => {
    const s = Math.min(MAX, Math.max(MIN, Math.round(next * 100) / 100));
    setScale(s);
    if (s === MIN) setPos({ x: 0, y: 0 }); // recenter when back to fit
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomTo(scale + STEP);
      else if (e.key === "-" || e.key === "_") zoomTo(scale - STEP);
      else if (e.key === "0") zoomTo(MIN);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scale, zoomTo, onClose]);

  function onWheel(e: React.WheelEvent) {
    zoomTo(scale + (e.deltaY < 0 ? STEP : -STEP));
  }

  function onPointerDown(e: React.PointerEvent) {
    if (scale <= MIN) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setPos({
      x: drag.current.ox + (e.clientX - drag.current.x),
      y: drag.current.oy + (e.clientY - drag.current.y),
    });
  }
  function onPointerUp() {
    drag.current = null;
    setDragging(false);
  }

  const name = filename || src.split("/").pop()?.split("?")[0] || "image.png";
  const canZoomOut = scale > MIN;
  const canZoomIn = scale < MAX;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      onWheel={onWheel}
    >
      {/* Image stage — clicks here don't close (only the backdrop does) */}
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center overflow-hidden",
          scale > MIN ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
        )}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => zoomTo(scale > MIN ? MIN : 2)}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="max-h-[92vh] max-w-[94vw] select-none object-contain shadow-2xl"
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 0.12s ease-out",
          }}
        />
      </div>

      {/* Toolbar */}
      <div
        className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/70 px-2 py-1.5 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <ToolBtn label="Zoom out" onClick={() => zoomTo(scale - STEP)} disabled={!canZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </ToolBtn>
        <button
          onClick={() => zoomTo(MIN)}
          className="min-w-[3.25rem] rounded-md px-2 py-1 text-center font-mono text-xs text-white/80 hover:bg-white/10"
          title="Reset to fit"
        >
          {Math.round(scale * 100)}%
        </button>
        <ToolBtn label="Zoom in" onClick={() => zoomTo(scale + STEP)} disabled={!canZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </ToolBtn>
        <div className="mx-1 h-5 w-px bg-white/15" />
        <ToolBtn label="Fit to screen" onClick={() => zoomTo(MIN)}>
          <Maximize className="h-4 w-4" />
        </ToolBtn>
        <a
          href={src}
          download={name}
          onClick={(e) => e.stopPropagation()}
          className="grid h-8 w-8 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          title="Download"
        >
          <Download className="h-4 w-4" />
        </a>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="grid h-8 w-8 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          title="Open in new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/60 text-white/80 transition-colors hover:bg-black/80 hover:text-white"
        title="Close (Esc)"
      >
        <X className="h-5 w-5" />
      </button>
    </motion.div>
  );
}

function ToolBtn({
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
