import type { RefObject } from "react";

interface Props {
  value: string;
  /** The parent copies the textarea's scroll offsets onto this element. */
  scrollRef: RefObject<HTMLDivElement>;
}

/** A line that contains nothing but a BREAK token (plus commas/whitespace). */
const BREAK_LINE = /^\s*,?\s*BREAK\s*,?\s*$/;

/** Render a text line invisibly, except mid-line BREAK words get an amber pill. */
function GhostLine({ line }: { line: string }) {
  const parts = line.split(/(\bBREAK\b)/);
  return (
    <div className="text-transparent">
      {parts.map((p, i) =>
        p === "BREAK" ? (
          <span key={i} className="rounded bg-[var(--color-amber)]/15">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
      {line === "" && " "}
    </div>
  );
}

/**
 * Backdrop behind the (transparent-background) prompt textarea, rendered only
 * when the prompt contains BREAK. Text is painted invisibly — the textarea's
 * own text stays on top — while standalone BREAK lines draw a full-width
 * amber rule and mid-line BREAKs get a subtle pill, so chunk boundaries are
 * visible while typing.
 *
 * The box metrics (padding, font, line-height, wrapping) MUST match the
 * textarea's classes in TagAutocomplete exactly or the overlay drifts out of
 * alignment with the real text.
 */
export function BreakBackdrop({ value, scrollRef }: Props) {
  const lines = value.split("\n");
  return (
    <div
      ref={scrollRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-transparent bg-[var(--color-ink)] px-3 py-2 pr-8 text-sm leading-relaxed"
    >
      {lines.map((line, i) =>
        BREAK_LINE.test(line) ? (
          <div key={i} className="relative">
            {/* invisible text keeps the line box identical to the textarea's */}
            <span className="invisible">{line}</span>
            <div className="absolute inset-x-0 top-1/2 border-t border-[var(--color-amber)]/50" />
          </div>
        ) : (
          <GhostLine key={i} line={line} />
        ),
      )}
    </div>
  );
}
