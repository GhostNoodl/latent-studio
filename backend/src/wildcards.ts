import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { config } from "./config.ts";

/**
 * Prompt wildcards: `__name__` pulls a random line from `<wildcardsDir>/name.txt`
 * (recursively), and inline `{a|b|c}` picks one option. Expanded per job so a
 * batch rolls different values. Files are read fresh so edits take effect live.
 */

mkdirSync(config.wildcardsDir, { recursive: true });

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

function lines(name: string): string[] {
  const file = join(config.wildcardsDir, `${name}.txt`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** All wildcard names (without `.txt`), recursing into sub-folders, `/`-joined. */
export function listWildcards(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        walk(join(dir, e.name), `${prefix}${e.name}/`);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".txt")) {
        out.push(`${prefix}${e.name.replace(/\.txt$/i, "")}`);
      }
    }
  };
  walk(config.wildcardsDir, "");
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve a wildcard name to an absolute `.txt` path under `wildcardsDir`, or
 * null if the name is malformed or would escape the directory (path traversal).
 */
function resolveWildcardPath(name: string): string | null {
  const clean = String(name ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\.txt$/i, "");
  if (!clean || !/^[A-Za-z0-9_\-/]+$/.test(clean) || clean.includes("..")) return null;
  const abs = resolve(config.wildcardsDir, `${clean}.txt`);
  const rel = relative(config.wildcardsDir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

/** Raw file contents for a wildcard, or null if it doesn't exist / bad name. */
export function readWildcard(name: string): string | null {
  const p = resolveWildcardPath(name);
  if (!p || !existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

/** Create or overwrite a wildcard file. Returns false for an invalid name. */
export function writeWildcard(name: string, content: string): boolean {
  const p = resolveWildcardPath(name);
  if (!p) return false;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
  return true;
}

/** Delete a wildcard file. Returns false if the name is bad or it's missing. */
export function deleteWildcard(name: string): boolean {
  const p = resolveWildcardPath(name);
  if (!p || !existsSync(p)) return false;
  rmSync(p);
  return true;
}

export function expandWildcards(text: string, depth = 0): string {
  if (typeof text !== "string" || depth > 12) return text;
  let out = text;
  // __name__ file wildcards
  out = out.replace(/__([A-Za-z0-9_\-/]+)__/g, (_m, name: string) => {
    const arr = lines(name);
    return arr.length ? expandWildcards(pick(arr), depth + 1) : `__${name}__`;
  });
  // {a|b|c} inline choices (innermost first via the no-brace char class)
  out = out.replace(/\{([^{}]+)\}/g, (_m, body: string) =>
    expandWildcards(pick(body.split("|")), depth + 1),
  );
  return out;
}
