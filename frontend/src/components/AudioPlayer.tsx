import { useEffect, useRef, useState } from "react";
import { Download, Music2, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/** Small, mobile-safe audio transport shared by Generate and Gallery. Native
 * playback does the decoding; the custom chrome keeps it usable in compact tiles. */
export function AudioPlayer({
  src,
  filename,
  compact = false,
  className,
}: {
  src: string;
  filename?: string;
  compact?: boolean;
  className?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [src]);

  async function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) await el.play().catch(() => {});
    else el.pause();
  }

  function seek(value: number) {
    const el = audio.current;
    if (!el || !Number.isFinite(value)) return;
    el.currentTime = value;
    setCurrent(value);
  }

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]",
        compact ? "gap-2 p-2" : "gap-4 p-4 sm:p-5",
        className,
      )}
    >
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
      />

      <div className={cn("flex items-center", compact ? "gap-2" : "gap-3")}>
        <div
          className={cn(
            "grid shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-violet)]/15 text-[var(--color-violet)]",
            compact ? "h-9 w-9" : "h-12 w-12",
          )}
        >
          <Music2 className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[var(--color-text)]", compact ? "text-[11px]" : "text-sm")}>
            {filename ?? "Generated audio"}
          </div>
          {!compact && <div className="mt-0.5 text-[11px] text-[var(--color-faint)]">MiniMax Music 3</div>}
        </div>
        {!compact && (
          <a
            href={src}
            download={filename}
            title="Download audio"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
          >
            <Download className="h-4 w-4" />
          </a>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className={cn(
            "grid shrink-0 place-items-center rounded-full bg-[var(--color-amber)] text-[var(--color-on-amber)] transition-opacity hover:opacity-90",
            compact ? "h-8 w-8" : "h-10 w-10",
          )}
        >
          {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
        </button>
        <span className="w-9 shrink-0 text-right font-mono text-[10px] text-[var(--color-faint)]">{clock(current)}</span>
        <input
          aria-label="Audio position"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          disabled={!duration}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--color-amber)] disabled:cursor-default"
        />
        <span className="w-9 shrink-0 font-mono text-[10px] text-[var(--color-faint)]">{clock(duration)}</span>
      </div>
    </div>
  );
}
