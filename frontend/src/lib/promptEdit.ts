/**
 * Pure text transforms for the prompt box — weighting emphasis and token
 * insertion. Each returns the new text plus where the selection should land, so
 * the caller can restore a highlight (e.g. so repeated Ctrl+↑ keeps bumping the
 * same word). Shared by the keyboard handler and the PromptToolbar buttons.
 */

export interface EditResult {
  text: string;
  selStart: number;
  selEnd: number;
}

/** Expand an empty selection to the comma/newline-delimited token at the caret. */
function tokenSpan(text: string, start: number, end: number): [number, number] {
  if (start !== end) return [start, end];
  const before = text.slice(0, start);
  const s = Math.max(before.lastIndexOf(","), before.lastIndexOf("\n")) + 1;
  const rel = text.slice(start).search(/[,\n]/);
  const e = rel === -1 ? text.length : start + rel;
  let ss = s;
  let ee = e;
  while (ss < ee && /\s/.test(text[ss]!)) ss++;
  while (ee > ss && /\s/.test(text[ee - 1]!)) ee--;
  return ss < ee ? [ss, ee] : [start, start];
}

const WEIGHTED = /^\((.*):(-?\d+(?:\.\d+)?)\)$/;

/**
 * Bump A1111/ComfyUI `(word:1.1)` emphasis on the selection (or the token at the
 * caret) by `delta`. Clamps to 0–2, rounds to 1 decimal, and unwraps at exactly
 * 1.0 so nudging back to neutral removes the redundant parens.
 */
export function adjustWeight(text: string, start: number, end: number, delta: number): EditResult {
  const [s, e] = tokenSpan(text, start, end);
  const span = text.slice(s, e);
  if (!span) return { text, selStart: start, selEnd: end };
  const m = span.match(WEIGHTED);
  const inner = m ? m[1]! : span;
  const base = m ? parseFloat(m[2]!) : 1.0;
  let w = Math.round((base + delta) * 10) / 10;
  w = Math.max(0, Math.min(2, w));
  const replacement = w === 1 ? inner : `(${inner}:${w.toFixed(1)})`;
  const next = text.slice(0, s) + replacement + text.slice(e);
  return { text: next, selStart: s, selEnd: s + replacement.length };
}

/**
 * Insert `token` at the caret (replacing any selection), adding ", " separators
 * when it would butt up against adjacent non-separator text. Caret lands after
 * the inserted token.
 */
export function insertToken(text: string, start: number, end: number, token: string): EditResult {
  const left = text.slice(0, start);
  const right = text.slice(end);
  const needBefore = left.trim().length > 0 && !/[,\s]$/.test(left);
  const needAfter = right.trim().length > 0 && !/^[,\s]/.test(right);
  const piece = `${needBefore ? ", " : ""}${token}${needAfter ? ", " : ""}`;
  const next = left + piece + right;
  const caret = left.length + (needBefore ? 2 : 0) + token.length;
  return { text: next, selStart: caret, selEnd: caret };
}
