/**
 * Runtime accent theming. Every component references the accent via CSS custom
 * properties (--color-amber = primary, --color-violet = secondary), so swapping
 * those on <html> restyles the whole app live — no rebuild, no per-component work.
 */

export interface Theme {
  id: string;
  name: string;
  primary: string; // warm/primary accent  → --color-amber
  secondary: string; // cool/secondary accent → --color-violet
}

export const THEMES: Theme[] = [
  { id: "ember", name: "Ember", primary: "#f2a65a", secondary: "#8b7fe8" },
  { id: "sakura", name: "Sakura", primary: "#f27aae", secondary: "#8b7fe8" },
  { id: "phosphor", name: "Phosphor", primary: "#6bd6a8", secondary: "#5ab0f2" },
  { id: "tide", name: "Tide", primary: "#5ab0f2", secondary: "#8b7fe8" },
  { id: "magma", name: "Magma", primary: "#f2685f", secondary: "#f2a65a" },
  { id: "ultraviolet", name: "Ultraviolet", primary: "#9a86ff", secondary: "#f2a65a" },
  { id: "gold", name: "Gold", primary: "#e8c15a", secondary: "#8b7fe8" },
  { id: "citrus", name: "Citrus", primary: "#a9d95a", secondary: "#f2a65a" },
];

export const DEFAULT_THEME_ID = "ember";
export const DEFAULT_SECONDARY = "#8b7fe8";

/** Resolve the effective primary/secondary for a stored theme id + custom accent. */
export function resolveTheme(themeId: string, customPrimary: string): { primary: string; secondary: string } {
  if (themeId === "custom") return { primary: customPrimary, secondary: DEFAULT_SECONDARY };
  const t = THEMES.find((x) => x.id === themeId) ?? THEMES[0]!;
  return { primary: t.primary, secondary: t.secondary };
}

/** Apply an accent pair to the document, deriving dim + on-accent text shades. */
export function applyTheme(primary: string, secondary: string): void {
  const root = document.documentElement;
  root.style.setProperty("--color-amber", primary);
  root.style.setProperty("--color-amber-dim", darken(primary, 0.34));
  root.style.setProperty("--color-on-amber", onAccent(primary));
  root.style.setProperty("--color-violet", secondary);
  root.style.setProperty("--color-violet-dim", darken(secondary, 0.34));
  root.style.setProperty("--color-on-violet", onAccent(secondary));
}

// ── color helpers ─────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Blend a hex color toward a target (t=0 → color, t=1 → target). */
function mix(hex: string, target: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = hexToRgb(target);
  return rgbToHex(r + (tr - r) * t, g + (tg - g) * t, b + (tb - b) * t);
}

function darken(hex: string, t: number): string {
  return mix(hex, "#000000", t);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Readable text color to sit on an accent fill: deep tint for bright, light for dark. */
function onAccent(hex: string): string {
  return luminance(hex) > 0.42 ? mix(hex, "#000000", 0.86) : "#f4f6fa";
}
