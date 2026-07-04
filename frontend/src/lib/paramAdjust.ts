import type { ParamSpec } from "@latent/shared";

/**
 * Display-time tweaks to a param: clearer labels for the hires upscaler/scale,
 * and sane UI bounds (ComfyUI's raw maxes are absurd — e.g. 16384px width).
 * The submitted value is unaffected beyond clamping to these bounds.
 */
export function adjustSpec(spec: ParamSpec): ParamSpec {
  let s = spec;

  // Clearer labels for ambiguous hires-fix inputs.
  if (s.modelKind === "upscale") s = { ...s, label: "Upscaler" };
  else if (s.input === "percent") s = { ...s, label: "Hires scale %" };

  const l = s.label.toLowerCase();
  const i = s.input;
  const bound = (min: number, max: number, step: number) => {
    s = { ...s, min, max, step };
  };

  if (i === "width" || i === "height" || /\b(width|height)\b/.test(l)) bound(256, 2048, 8);
  else if (i === "batch_size" || /\bbatch\b/.test(l)) bound(1, 16, 1);
  else if (i === "steps" || i === "steps_total" || /\bsteps?\b/.test(l)) bound(1, 100, 1);
  else if (i === "refiner_step" || /refiner/.test(l)) bound(0, 100, 1);
  else if (i === "cfg" || /\bcfg\b|guidance/.test(l)) bound(0, 30, 0.5);
  else if (/denoise/.test(l)) bound(0, 1, 0.01);
  else if (i === "percent" || /hires scale/.test(l)) bound(0, 100, 5);
  else if (/\bfps\b/.test(l)) bound(1, 60, 1);
  else if (/\bseconds\b/.test(l)) bound(1, 20, 1);
  else if (/headroom/.test(l)) bound(0, 8, 1);

  return s;
}
