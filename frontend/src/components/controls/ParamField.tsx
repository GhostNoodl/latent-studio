import { Dices, Info } from "lucide-react";
import type { LoraEntry, ParamSpec, ParamValue } from "@latent/shared";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/controls/ImageUpload";
import { MaskCanvas } from "@/components/controls/MaskCanvas";
import { ControlNetPreview } from "@/components/controls/ControlNetPreview";
import { ModelPicker } from "@/components/controls/ModelPicker";
import { LoraControl } from "@/components/controls/LoraControl";
import { TagAutocomplete } from "@/components/controls/TagAutocomplete";
import { SearchableSelect } from "@/components/controls/SearchableSelect";
import { adjustSpec } from "@/lib/paramAdjust";

interface FieldProps {
  spec: ParamSpec;
  value: ParamValue;
  onChange: (value: ParamValue) => void;
  /** For LoRA fields: append a newly-added LoRA's trigger words to the prompt. */
  onLoraTriggers?: (words: string) => void;
  /** Override textarea height (rows) — e.g. for the wide prompt area. */
  textareaRows?: number;
  /** For a `mask` control: URL of the source image to paint the mask over. */
  maskSource?: string;
  /** For a `mask` control: the source image's ComfyUI input filename (auto-mask). */
  maskSourceName?: string;
  /** For a source-less `mask` control (e.g. txt2img regions): blank-canvas size. */
  blankSize?: { w: number; h: number };
  /** All current param values — used by the ControlNet preview to read sibling params. */
  allValues?: Record<string, ParamValue>;
}

export function ParamField({ spec: rawSpec, value, onChange, onLoraTriggers, textareaRows, maskSource, maskSourceName, blankSize, allValues }: FieldProps) {
  const spec = adjustSpec(rawSpec);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <label className="min-w-0 truncate text-xs font-medium text-[var(--color-muted)]">
          {spec.label}
        </label>
        {spec.help && (
          <span
            title={spec.help}
            aria-label={spec.help}
            className="shrink-0 cursor-help text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)]"
          >
            <Info className="h-3 w-3" />
          </span>
        )}
      </div>
      <Control
        spec={spec}
        value={value}
        onChange={onChange}
        onLoraTriggers={onLoraTriggers}
        textareaRows={textareaRows}
        maskSource={maskSource}
        maskSourceName={maskSourceName}
        blankSize={blankSize}
      />
      {spec.cnPreview && (
        <ControlNetPreview
          preprocessor={String(value ?? "")}
          imageName={
            spec.cnPreview.imageKey && allValues?.[spec.cnPreview.imageKey]
              ? String(allValues[spec.cnPreview.imageKey])
              : undefined
          }
          resolution={Number(
            (spec.cnPreview.resolutionKey && allValues?.[spec.cnPreview.resolutionKey]) || 512,
          )}
        />
      )}
    </div>
  );
}

function Control({ spec, value, onChange, onLoraTriggers, textareaRows, maskSource, maskSourceName, blankSize }: FieldProps) {
  // LoRA stacks get the dedicated multi-LoRA manager.
  if (spec.control === "loras") {
    return (
      <LoraControl
        value={(value as LoraEntry[]) ?? []}
        onChange={onChange}
        onAddTriggers={onLoraTriggers}
      />
    );
  }

  // Model selectors get the rich picker (thumbnails, clean names, metadata).
  if (spec.modelKind) {
    return (
      <ModelPicker
        kind={spec.modelKind}
        options={spec.options ?? []}
        value={String(value ?? "")}
        onChange={onChange}
      />
    );
  }

  switch (spec.control) {
    case "textarea":
      return (
        <TagAutocomplete
          value={String(value ?? "")}
          onChange={onChange}
          placeholder={spec.label}
          historyKey={spec.key}
          rows={textareaRows}
        />
      );

    case "text":
      return (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputBase, "h-9")}
        />
      );

    case "select":
      return (
        <SearchableSelect
          value={String(value ?? "")}
          options={spec.options ?? []}
          onChange={onChange}
          placeholder={spec.label}
        />
      );

    case "slider":
      return (
        <div className="flex items-center gap-2.5">
          <input
            type="range"
            min={spec.min ?? 0}
            max={spec.max ?? 100}
            step={spec.step ?? 1}
            value={numVal(value)}
            onChange={(e) => pushNum(e.target.value, onChange)}
            className="latent-range min-w-0 flex-1"
          />
          <input
            type="number"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            value={numVal(value)}
            onChange={(e) => pushNum(e.target.value, onChange)}
            onBlur={(e) => onChange(clampVal(Number(e.target.value), spec.min, spec.max))}
            className={cn(inputBase, "h-7 w-16 shrink-0 px-1.5 text-center font-mono text-xs")}
          />
        </div>
      );

    case "number":
      return (
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          value={numVal(value)}
          onChange={(e) => pushNum(e.target.value, onChange)}
          onBlur={(e) => onChange(clampVal(Number(e.target.value), spec.min, spec.max))}
          className={cn(inputBase, "h-9 font-mono")}
        />
      );

    case "seed":
      return (
        <div className="flex gap-2">
          <input
            type="number"
            value={numVal(value)}
            onChange={(e) => pushNum(e.target.value, onChange)}
            className={cn(inputBase, "h-9 font-mono")}
          />
          <button
            type="button"
            title="Randomize seed"
            onClick={() => onChange(Math.floor(Math.random() * 2 ** 48))}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-amber)]"
          >
            <Dices className="h-4 w-4" />
          </button>
        </div>
      );

    case "toggle":
      return (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          onClick={() => onChange(!value)}
          className={cn(
            "inline-flex h-[24px] w-[44px] shrink-0 items-center rounded-full transition-colors",
            value ? "bg-[var(--color-amber)]" : "bg-[var(--color-elevated)]",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
              value ? "translate-x-[22px]" : "translate-x-[2px]",
            )}
          />
        </button>
      );

    case "image":
      return <ImageUpload value={value} onChange={onChange} />;

    case "mask":
      return (
        <MaskCanvas
          value={value}
          onChange={onChange}
          sourceUrl={maskSource}
          sourceName={maskSourceName}
          blankSize={maskSource ? undefined : blankSize}
        />
      );

    default:
      return null;
  }
}

function clampVal(v: number, min?: number, max?: number): number {
  if (Number.isNaN(v)) return min ?? 0;
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
}

/** Coerce a stored value to a finite number for display (never renders NaN). */
function numVal(value: ParamValue): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Push a numeric change, ignoring partial/invalid input (e.g. "-", "1e"). */
function pushNum(raw: string, onChange: (v: ParamValue) => void): void {
  const n = Number(raw);
  if (!Number.isNaN(n)) onChange(n);
}

const inputBase =
  "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)] focus:outline-none";
