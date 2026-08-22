const AUXILIARY_MODEL = /(?:^|[_ .-])(vae|audio|text|projection|encoder|clip)(?:[_ .-]|$)/i;
const GENERIC_TOKEN = new Set(["checkpoint", "model", "safetensors", "version"]);

const baseName = (file: string) => file.split(/[\\/]/).pop() ?? file;
const searchable = (file: string) =>
  baseName(file)
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

function meaningfulTokens(file: string): string[] {
  return searchable(file)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !GENERIC_TOKEN.has(token) && !/^v?\d+$/.test(token));
}

/**
 * Pick a sane installed checkpoint when a pipeline's saved model was removed.
 * Prefer a related model name and never select an obvious VAE/text/audio helper
 * merely because that file was placed in ComfyUI's checkpoints directory.
 */
export function pickCheckpointFallback(
  expected: string,
  installed: string[],
  allowed: string[] = [],
): string | undefined {
  const allowedNames = new Set(allowed.map(baseName));
  const candidates = installed.filter((file) => allowedNames.size === 0 || allowedNames.has(baseName(file)));
  if (candidates.length === 0) return undefined;

  const exact = candidates.find((file) => baseName(file) === baseName(expected));
  if (exact) return exact;

  const safe = candidates.filter((file) => !AUXILIARY_MODEL.test(searchable(file)));
  const pool = safe.length > 0 ? safe : candidates;
  const tokens = meaningfulTokens(expected);
  const expectedName = searchable(expected);

  return [...pool].sort((a, b) => {
    const score = (file: string) => {
      const name = searchable(file);
      let value = tokens.reduce((sum, token) => sum + (name.includes(token) ? token.length : 0), 0);
      if (expectedName.includes("sdxl") && /(?:sd)?xl/.test(name)) value += 2;
      return value;
    };
    return score(b) - score(a) || baseName(a).localeCompare(baseName(b));
  })[0];
}
