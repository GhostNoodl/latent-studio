// Prompt token-count estimation (CLIP-style).
//
// ComfyUI exposes no tokenize endpoint and Latent doesn't know which CLIP model
// a pipeline uses, so this is a documented APPROXIMATION (~±10%) of CLIP BPE
// tokenization — accurate enough for what users care about: the 75-token chunk
// boundary (CLIP's 77-token window minus BOS/EOS).

/** Usable token budget per CLIP chunk (77 minus start/end tokens). */
export const CHUNK_LIMIT = 75;

/**
 * Split a prompt on A1111-style BREAK tokens (uppercase, standalone word).
 * Mirrors `splitBreakChunks` in shared/src/index.ts — keep the rule identical:
 * split on `\bBREAK\b`, trim surrounding whitespace/commas, drop empty chunks.
 * Unlike the backend version this returns the whole (trimmed) text as a single
 * chunk when no BREAK is present, so it's always usable for display.
 */
export function splitBreak(text: string): string[] {
  const chunks = text
    .split(/\bBREAK\b/)
    .map((c) => c.replace(/^[\s,]+|[\s,]+$/g, ""))
    .filter((c) => c.length > 0);
  return chunks;
}

/** Whether the prompt contains a BREAK token at all. */
export function hasBreak(text: string): boolean {
  return /\bBREAK\b/.test(text);
}

/**
 * Estimate CLIP tokens for one prompt chunk. Emphasis syntax (`(word:1.2)`,
 * `((word))`, `[word]`) is parsed out by A1111/ComfyUI and doesn't consume
 * prompt tokens, so it's stripped first. Each remaining word costs
 * `max(1, ceil(len/4))` (a rough BPE fit for English + booru tags); wildcard
 * (`__name__`) and embedding references count as a few tokens each.
 */
export function estimateTokens(text: string): number {
  // Strip emphasis weight suffixes (:1.2) and the emphasis brackets themselves.
  const cleaned = text
    .replace(/:\d+(?:\.\d+)?/g, "")
    .replace(/[()\[\]]/g, "");
  const words = cleaned.split(/[\s,]+/).filter((w) => w.length > 0);
  let tokens = 0;
  for (const w of words) {
    if (/^__.+__$/.test(w) || /^embedding:/i.test(w)) {
      tokens += 3; // unknown expansion — small placeholder cost
    } else {
      tokens += Math.max(1, Math.ceil(w.length / 4));
    }
  }
  return tokens;
}

export interface ChunkStats {
  /** Estimated tokens per BREAK chunk (one entry when no BREAK). */
  chunks: number[];
  total: number;
}

/** Per-chunk token estimates for a prompt (splits on BREAK). */
export function chunkStats(text: string): ChunkStats {
  const chunks = splitBreak(text).map(estimateTokens);
  return { chunks, total: chunks.reduce((a, b) => a + b, 0) };
}
