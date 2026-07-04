import { existsSync, readFileSync } from "node:fs";
import { config } from "./config.ts";
import type { TagSuggestion } from "@latent/shared";

/**
 * Booru tag autocomplete from the danbooru/e621 CSV (`name,category,count,"aliases"`).
 * The file is pre-sorted by post count (descending), so we can collect the first
 * matches encountered and they're already the most popular — no sorting needed.
 */

interface TagRow {
  name: string;
  category: number;
  count: number;
  aliases: string[];
}

let rows: TagRow[] | null = null;

function load(): TagRow[] {
  if (rows) return rows;
  rows = [];
  if (!existsSync(config.tagsCsv)) return rows;
  const text = readFileSync(config.tagsCsv, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const c1 = line.indexOf(",");
    if (c1 < 0) continue;
    const c2 = line.indexOf(",", c1 + 1);
    if (c2 < 0) continue;
    const c3 = line.indexOf(",", c2 + 1);
    const name = line.slice(0, c1);
    const category = Number(line.slice(c1 + 1, c2)) || 0;
    const count = Number((c3 < 0 ? line.slice(c2 + 1) : line.slice(c2 + 1, c3)).trim()) || 0;
    const aliasRaw = c3 < 0 ? "" : line.slice(c3 + 1).replace(/^"|"$/g, "");
    const aliases = aliasRaw ? aliasRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    rows.push({ name, category, count, aliases });
  }
  return rows;
}

export function searchTags(query: string, limit = 20): TagSuggestion[] {
  const all = load();
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!q) return [];

  // File is sorted by post count (desc), so collecting in order yields the most
  // popular relevant tags first — any match (name or alias) ranks by popularity.
  const out: TagSuggestion[] = [];
  for (const r of all) {
    const n = r.name.toLowerCase();
    if (n.includes(q)) {
      out.push({ name: r.name, category: r.category, count: r.count });
    } else {
      const a = r.aliases.find((al) => al.toLowerCase().includes(q));
      if (a) out.push({ name: r.name, category: r.category, count: r.count, alias: a });
    }
    if (out.length >= limit) break;
  }
  return out;
}
