import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config.ts";
import type {
  Collection,
  ComfyInputValue,
  GenerationRecord,
  GenerationStatus,
  ModelFolder,
  ModelInfo,
  ModelKind,
  OutputAsset,
  PipelineType,
  Preset,
  PresetKind,
  WorkflowManifest,
} from "@latent/shared";

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(join(config.dataDir, "outputs"), { recursive: true });

export const db = new Database(join(config.dataDir, "latent.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS workflows (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    workflow    TEXT NOT NULL,   -- JSON: ComfyWorkflow
    params      TEXT NOT NULL,   -- JSON: ParamSpec[]
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS generations (
    id            TEXT PRIMARY KEY,
    pipeline_id   TEXT NOT NULL,
    pipeline_name TEXT NOT NULL,
    pipeline_type TEXT NOT NULL,
    status        TEXT NOT NULL,
    prompt_id     TEXT,
    seed          INTEGER,
    params        TEXT NOT NULL,   -- JSON: Record<string, value>
    outputs       TEXT NOT NULL,   -- JSON: OutputAsset[]
    thumbnail     TEXT,
    favorite      INTEGER NOT NULL DEFAULT 0,
    rating        INTEGER,
    error         TEXT,
    created_at    TEXT NOT NULL,
    completed_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_generations_prompt ON generations(prompt_id);

  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS generation_tags (
    generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (generation_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS presets (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'bundle',
    pipeline_id TEXT,
    name        TEXT NOT NULL,
    values_json TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  -- Civitai enrichments for models lacking local metadata (persisted, on-demand).
  CREATE TABLE IF NOT EXISTS model_meta (
    kind TEXT NOT NULL,
    file TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (kind, file)
  );

  -- Collections: named albums that group generations.
  CREATE TABLE IF NOT EXISTS collections (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS collection_items (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    added_at      TEXT NOT NULL,
    PRIMARY KEY (collection_id, generation_id)
  );

  -- Model folders: user-created groups for organizing models (by kind + file).
  CREATE TABLE IF NOT EXISTS model_folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_folder_items (
    folder_id TEXT NOT NULL REFERENCES model_folders(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL,
    file      TEXT NOT NULL,
    added_at  TEXT NOT NULL,
    PRIMARY KEY (folder_id, kind, file)
  );

  -- Simple key/value app settings (e.g. the Civitai API key).
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Models hidden from the library (file stays on disk; just filtered from view).
  CREATE TABLE IF NOT EXISTS hidden_models (
    kind TEXT NOT NULL,
    file TEXT NOT NULL,
    PRIMARY KEY (kind, file)
  );
`);

// Older databases created `presets` without kind, and with a NOT NULL
// pipeline_id — patch them. The NOT NULL blocks global (pipeline-independent)
// presets like prompt snippets, which the type + list layer already support.
{
  const info = db.prepare(`PRAGMA table_info(presets)`).all() as {
    name: string;
    notnull: number;
  }[];
  if (!info.some((c) => c.name === "kind")) {
    db.exec(`ALTER TABLE presets ADD COLUMN kind TEXT NOT NULL DEFAULT 'bundle'`);
  }
  // SQLite can't drop a column's NOT NULL in place — rebuild the table if needed.
  const pip = info.find((c) => c.name === "pipeline_id");
  if (pip && pip.notnull === 1) {
    db.exec(`
      CREATE TABLE presets_new (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL DEFAULT 'bundle',
        pipeline_id TEXT,
        name        TEXT NOT NULL,
        values_json TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      INSERT INTO presets_new (id, kind, pipeline_id, name, values_json, created_at)
        SELECT id, kind, pipeline_id, name, values_json, created_at FROM presets;
      DROP TABLE presets;
      ALTER TABLE presets_new RENAME TO presets;
    `);
  }
}

// Workflows gained base-group / mode / sort-order (nullable) for the two-level
// tab UI (a base family like "Illustrious" with txt2img/img2img/inpaint sub-tabs).
{
  const info = db.prepare(`PRAGMA table_info(workflows)`).all() as { name: string }[];
  if (!info.some((c) => c.name === "base_group"))
    db.exec(`ALTER TABLE workflows ADD COLUMN base_group TEXT`);
  if (!info.some((c) => c.name === "mode")) db.exec(`ALTER TABLE workflows ADD COLUMN mode TEXT`);
  if (!info.some((c) => c.name === "sort_order"))
    db.exec(`ALTER TABLE workflows ADD COLUMN sort_order INTEGER`);
}

// On startup, no generation can still be in flight — the upstream WS tracking is
// reset with the process, so anything left `queued`/`running` would never
// finalize. Reconcile so the gallery/queue don't show permanent ghosts.
db.prepare(
  `UPDATE generations SET status = 'canceled', completed_at = ?
   WHERE status IN ('queued', 'running')`,
).run(new Date().toISOString());

// ── Row <-> domain mapping ───────────────────────────────────────────────────

interface GenerationRow {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  pipeline_type: string;
  status: string;
  prompt_id: string | null;
  seed: number | null;
  params: string;
  outputs: string;
  thumbnail: string | null;
  favorite: number;
  rating: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

function rowToGeneration(row: GenerationRow, tags: string[]): GenerationRecord {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    pipelineName: row.pipeline_name,
    pipelineType: row.pipeline_type as PipelineType,
    status: row.status as GenerationStatus,
    promptId: row.prompt_id ?? undefined,
    seed: row.seed ?? undefined,
    params: JSON.parse(row.params) as Record<string, ComfyInputValue>,
    outputs: JSON.parse(row.outputs) as OutputAsset[],
    thumbnail: row.thumbnail ?? undefined,
    favorite: row.favorite === 1,
    rating: row.rating ?? undefined,
    error: row.error ?? undefined,
    tags,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

// ── Prepared statements ──────────────────────────────────────────────────────

const insertGenerationStmt = db.prepare(`
  INSERT INTO generations
    (id, pipeline_id, pipeline_name, pipeline_type, status, prompt_id, seed,
     params, outputs, thumbnail, favorite, rating, error, created_at, completed_at)
  VALUES
    (@id, @pipeline_id, @pipeline_name, @pipeline_type, @status, @prompt_id, @seed,
     @params, @outputs, @thumbnail, @favorite, @rating, @error, @created_at, @completed_at)
`);

const tagsForStmt = db.prepare(`
  SELECT t.name FROM tags t
  JOIN generation_tags gt ON gt.tag_id = t.id
  WHERE gt.generation_id = ?
  ORDER BY t.name
`);

function tagsFor(generationId: string): string[] {
  return (tagsForStmt.all(generationId) as { name: string }[]).map((r) => r.name);
}

export const generations = {
  insert(rec: GenerationRecord): void {
    insertGenerationStmt.run({
      id: rec.id,
      pipeline_id: rec.pipelineId,
      pipeline_name: rec.pipelineName,
      pipeline_type: rec.pipelineType,
      status: rec.status,
      prompt_id: rec.promptId ?? null,
      seed: rec.seed ?? null,
      params: JSON.stringify(rec.params),
      outputs: JSON.stringify(rec.outputs),
      thumbnail: rec.thumbnail ?? null,
      favorite: rec.favorite ? 1 : 0,
      rating: rec.rating ?? null,
      error: rec.error ?? null,
      created_at: rec.createdAt,
      completed_at: rec.completedAt ?? null,
    });
  },

  update(id: string, patch: Partial<GenerationRecord>): GenerationRecord | undefined {
    const existing = generations.get(id);
    if (!existing) return undefined;
    const merged: GenerationRecord = { ...existing, ...patch };
    db.prepare(`
      UPDATE generations SET
        status = @status, prompt_id = @prompt_id, seed = @seed,
        params = @params, outputs = @outputs, thumbnail = @thumbnail,
        favorite = @favorite, rating = @rating, error = @error,
        completed_at = @completed_at
      WHERE id = @id
    `).run({
      id,
      status: merged.status,
      prompt_id: merged.promptId ?? null,
      seed: merged.seed ?? null,
      params: JSON.stringify(merged.params),
      outputs: JSON.stringify(merged.outputs),
      thumbnail: merged.thumbnail ?? null,
      favorite: merged.favorite ? 1 : 0,
      rating: merged.rating ?? null,
      error: merged.error ?? null,
      completed_at: merged.completedAt ?? null,
    });
    return merged;
  },

  get(id: string): GenerationRecord | undefined {
    const row = db.prepare(`SELECT * FROM generations WHERE id = ?`).get(id) as
      | GenerationRow
      | undefined;
    return row ? rowToGeneration(row, tagsFor(id)) : undefined;
  },

  byPromptId(promptId: string): GenerationRecord | undefined {
    const row = db.prepare(`SELECT * FROM generations WHERE prompt_id = ?`).get(promptId) as
      | GenerationRow
      | undefined;
    return row ? rowToGeneration(row, tagsFor(row.id)) : undefined;
  },

  list(
    opts: {
      limit?: number;
      offset?: number;
      favorite?: boolean;
      collection?: string;
      pipelineId?: string;
      search?: string;
    } = {},
  ): GenerationRecord[] {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.favorite) where.push(`g.favorite = 1`);
    let join = ``;
    if (opts.collection) {
      join = `JOIN collection_items ci ON ci.generation_id = g.id`;
      where.push(`ci.collection_id = ?`);
      args.push(opts.collection);
    }
    if (opts.pipelineId) {
      where.push(`g.pipeline_id = ?`);
      args.push(opts.pipelineId);
    }
    if (opts.search?.trim()) {
      // Whole-library search: prompt/params (JSON text), pipeline name, seed, tags.
      const like = `%${opts.search.trim()}%`;
      where.push(`(g.pipeline_name LIKE ? OR g.params LIKE ? OR CAST(g.seed AS TEXT) LIKE ?
        OR g.id IN (SELECT gt.generation_id FROM generation_tags gt
                    JOIN tags t ON t.id = gt.tag_id WHERE t.name LIKE ?))`);
      args.push(like, like, like, like);
    }
    const sql = `SELECT g.* FROM generations g ${join}
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY g.created_at DESC LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...args, limit, offset) as GenerationRow[];
    return rows.map((r) => rowToGeneration(r, tagsFor(r.id)));
  },

  setFavorite(id: string, favorite: boolean): GenerationRecord | undefined {
    db.prepare(`UPDATE generations SET favorite = ? WHERE id = ?`).run(favorite ? 1 : 0, id);
    return generations.get(id);
  },

  setRating(id: string, rating: number | null): GenerationRecord | undefined {
    db.prepare(`UPDATE generations SET rating = ? WHERE id = ?`).run(rating, id);
    return generations.get(id);
  },

  addTag(id: string, name: string): GenerationRecord | undefined {
    const tag = name.trim().toLowerCase();
    if (!tag) return generations.get(id);
    db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`).run(tag);
    const tagId = (db.prepare(`SELECT id FROM tags WHERE name = ?`).get(tag) as { id: number }).id;
    db.prepare(
      `INSERT OR IGNORE INTO generation_tags (generation_id, tag_id) VALUES (?, ?)`,
    ).run(id, tagId);
    return generations.get(id);
  },

  removeTag(id: string, name: string): GenerationRecord | undefined {
    const tag = name.trim().toLowerCase();
    db.prepare(
      `DELETE FROM generation_tags WHERE generation_id = ?
       AND tag_id = (SELECT id FROM tags WHERE name = ?)`,
    ).run(id, tag);
    return generations.get(id);
  },

  remove(id: string): void {
    deleteOutputFiles(generations.get(id));
    db.prepare(`DELETE FROM generations WHERE id = ?`).run(id);
  },

  removeMany(ids: string[]): void {
    for (const id of ids) deleteOutputFiles(generations.get(id));
    const stmt = db.prepare(`DELETE FROM generations WHERE id = ?`);
    db.transaction((list: string[]) => list.forEach((id) => stmt.run(id)))(ids);
  },
};

/** Best-effort removal of a generation's copied output files from disk. */
function deleteOutputFiles(rec: GenerationRecord | undefined): void {
  if (!rec) return;
  const dir = join(config.dataDir, "outputs");
  for (const out of rec.outputs) {
    const name = basename(decodeURIComponent(out.url));
    if (name) rmSync(join(dir, name), { force: true });
  }
}

// ── Collections (named albums of generations) ────────────────────────────────

interface CollectionRow {
  id: string;
  name: string;
  created_at: string;
  count: number;
  cover: string | null;
}

export const collections = {
  list(): Collection[] {
    // Count members + take the newest member's thumbnail as the cover.
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.created_at,
                COUNT(ci.generation_id) AS count,
                (SELECT g.thumbnail FROM collection_items ci2
                   JOIN generations g ON g.id = ci2.generation_id
                  WHERE ci2.collection_id = c.id
                  ORDER BY g.created_at DESC LIMIT 1) AS cover
           FROM collections c
           LEFT JOIN collection_items ci ON ci.collection_id = c.id
          GROUP BY c.id
          ORDER BY c.created_at DESC`,
      )
      .all() as CollectionRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      count: r.count,
      cover: r.cover ?? undefined,
      createdAt: r.created_at,
    }));
  },

  create(name: string): Collection {
    const id = nanoid(10);
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO collections (id, name, created_at) VALUES (?, ?, ?)`).run(
      id,
      name.trim() || "Untitled",
      createdAt,
    );
    return { id, name: name.trim() || "Untitled", count: 0, createdAt };
  },

  rename(id: string, name: string): void {
    db.prepare(`UPDATE collections SET name = ? WHERE id = ?`).run(name.trim() || "Untitled", id);
  },

  remove(id: string): void {
    db.prepare(`DELETE FROM collections WHERE id = ?`).run(id);
  },

  addItems(collectionId: string, generationIds: string[]): void {
    const now = new Date().toISOString();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO collection_items (collection_id, generation_id, added_at)
       VALUES (?, ?, ?)`,
    );
    db.transaction((ids: string[]) => ids.forEach((gid) => stmt.run(collectionId, gid, now)))(
      generationIds,
    );
  },

  removeItem(collectionId: string, generationId: string): void {
    db.prepare(
      `DELETE FROM collection_items WHERE collection_id = ? AND generation_id = ?`,
    ).run(collectionId, generationId);
  },

  /** Collection ids that contain a given generation (for the detail view). */
  idsFor(generationId: string): string[] {
    return (
      db
        .prepare(`SELECT collection_id FROM collection_items WHERE generation_id = ?`)
        .all(generationId) as { collection_id: string }[]
    ).map((r) => r.collection_id);
  },
};

// ── App settings (key/value) ─────────────────────────────────────────────────

export const settings = {
  get(key: string): string | undefined {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  },
  set(key: string, value: string): void {
    if (!value) {
      db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
      return;
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  },
};

// ── Hidden models (filtered from the library, file kept on disk) ─────────────

export const hiddenModels = {
  set(kind: ModelKind, file: string): void {
    db.prepare(`INSERT OR IGNORE INTO hidden_models (kind, file) VALUES (?, ?)`).run(kind, file);
  },
  unset(kind: ModelKind, file: string): void {
    db.prepare(`DELETE FROM hidden_models WHERE kind = ? AND file = ?`).run(kind, file);
  },
  filesForKind(kind: ModelKind): Set<string> {
    const rows = db.prepare(`SELECT file FROM hidden_models WHERE kind = ?`).all(kind) as {
      file: string;
    }[];
    return new Set(rows.map((r) => r.file));
  },
};

// ── Model folders (user-created groups for models) ───────────────────────────

export const modelFolders = {
  /** List folders. When `kind` is given, counts are scoped to that model kind. */
  list(kind?: ModelKind): ModelFolder[] {
    const rows = db
      .prepare(
        `SELECT f.id, f.name, f.created_at,
                (SELECT COUNT(*) FROM model_folder_items i
                  WHERE i.folder_id = f.id ${kind ? "AND i.kind = @kind" : ""}) AS count
           FROM model_folders f
          ORDER BY f.name COLLATE NOCASE`,
      )
      .all(kind ? { kind } : {}) as { id: string; name: string; created_at: string; count: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, count: r.count, createdAt: r.created_at }));
  },

  create(name: string): ModelFolder {
    const id = nanoid(10);
    const createdAt = new Date().toISOString();
    const clean = name.trim() || "Untitled";
    db.prepare(`INSERT INTO model_folders (id, name, created_at) VALUES (?, ?, ?)`).run(id, clean, createdAt);
    return { id, name: clean, count: 0, createdAt };
  },

  rename(id: string, name: string): void {
    db.prepare(`UPDATE model_folders SET name = ? WHERE id = ?`).run(name.trim() || "Untitled", id);
  },

  remove(id: string): void {
    db.prepare(`DELETE FROM model_folders WHERE id = ?`).run(id);
  },

  addItems(folderId: string, items: { kind: ModelKind; file: string }[]): void {
    const now = new Date().toISOString();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO model_folder_items (folder_id, kind, file, added_at) VALUES (?, ?, ?, ?)`,
    );
    db.transaction((list: { kind: ModelKind; file: string }[]) => {
      for (const it of list) stmt.run(folderId, it.kind, it.file, now);
    })(items);
  },

  removeItem(folderId: string, kind: ModelKind, file: string): void {
    db.prepare(
      `DELETE FROM model_folder_items WHERE folder_id = ? AND kind = ? AND file = ?`,
    ).run(folderId, kind, file);
  },

  /** Folder ids containing a given model. */
  foldersFor(kind: ModelKind, file: string): string[] {
    return (
      db
        .prepare(`SELECT folder_id FROM model_folder_items WHERE kind = ? AND file = ?`)
        .all(kind, file) as { folder_id: string }[]
    ).map((r) => r.folder_id);
  },

  /** Files of a given kind inside a folder (to filter the catalog). */
  filesIn(folderId: string, kind: ModelKind): Set<string> {
    const rows = db
      .prepare(`SELECT file FROM model_folder_items WHERE folder_id = ? AND kind = ?`)
      .all(folderId, kind) as { file: string }[];
    return new Set(rows.map((r) => r.file));
  },
};

// ── Workflow manifests ───────────────────────────────────────────────────────

interface WorkflowRow {
  id: string;
  name: string;
  type: string;
  workflow: string;
  params: string;
  base_group: string | null;
  mode: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

function rowToManifest(row: WorkflowRow): WorkflowManifest {
  return {
    id: row.id,
    name: row.name,
    type: row.type as PipelineType,
    workflow: JSON.parse(row.workflow),
    params: JSON.parse(row.params),
    ...(row.base_group ? { baseGroup: row.base_group } : {}),
    ...(row.mode ? { mode: row.mode } : {}),
    ...(row.sort_order != null ? { order: row.sort_order } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const workflows = {
  upsert(m: WorkflowManifest): void {
    db.prepare(`
      INSERT INTO workflows (id, name, type, workflow, params, base_group, mode, sort_order, created_at, updated_at)
      VALUES (@id, @name, @type, @workflow, @params, @base_group, @mode, @sort_order, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, type = excluded.type, workflow = excluded.workflow,
        params = excluded.params, base_group = excluded.base_group, mode = excluded.mode,
        sort_order = excluded.sort_order, updated_at = excluded.updated_at
    `).run({
      id: m.id,
      name: m.name,
      type: m.type,
      workflow: JSON.stringify(m.workflow),
      params: JSON.stringify(m.params),
      base_group: m.baseGroup ?? null,
      mode: m.mode ?? null,
      sort_order: m.order ?? null,
      created_at: m.createdAt,
      updated_at: m.updatedAt,
    });
  },

  get(id: string): WorkflowManifest | undefined {
    const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as
      | WorkflowRow
      | undefined;
    return row ? rowToManifest(row) : undefined;
  },

  list(): WorkflowManifest[] {
    const rows = db
      .prepare(`SELECT * FROM workflows ORDER BY (base_group IS NULL), base_group, sort_order, name`)
      .all() as WorkflowRow[];
    return rows.map(rowToManifest);
  },

  remove(id: string): void {
    db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
  },
};

// ── Model metadata (persisted Civitai enrichments) ───────────────────────────

export const modelMeta = {
  all(): { kind: ModelKind; file: string; data: Partial<ModelInfo> }[] {
    const rows = db.prepare(`SELECT kind, file, data FROM model_meta`).all() as {
      kind: string;
      file: string;
      data: string;
    }[];
    return rows.map((r) => ({
      kind: r.kind as ModelKind,
      file: r.file,
      data: JSON.parse(r.data) as Partial<ModelInfo>,
    }));
  },

  set(kind: ModelKind, file: string, data: Partial<ModelInfo>): void {
    db.prepare(
      `INSERT INTO model_meta (kind, file, data) VALUES (?, ?, ?)
       ON CONFLICT(kind, file) DO UPDATE SET data = excluded.data`,
    ).run(kind, file, JSON.stringify(data));
  },
};

// ── Presets (dimensions / styles / param bundles) ────────────────────────────

interface PresetRow {
  id: string;
  kind: string;
  pipeline_id: string | null;
  name: string;
  values_json: string;
  created_at: string;
}

function rowToPreset(r: PresetRow): Preset {
  return {
    id: r.id,
    kind: r.kind as PresetKind,
    pipelineId: r.pipeline_id,
    name: r.name,
    data: JSON.parse(r.values_json),
    createdAt: r.created_at,
  };
}

export const presets = {
  list(opts: { kind?: PresetKind; pipelineId?: string | null } = {}): Preset[] {
    const where: string[] = [];
    const args: (string | null)[] = [];
    if (opts.kind) {
      where.push(`kind = ?`);
      args.push(opts.kind);
    }
    if (opts.pipelineId !== undefined) {
      // Match this pipeline's presets plus global (null) ones.
      where.push(`(pipeline_id = ? OR pipeline_id IS NULL)`);
      args.push(opts.pipelineId);
    }
    const sql = `SELECT * FROM presets ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at`;
    return (db.prepare(sql).all(...args) as PresetRow[]).map(rowToPreset);
  },

  create(p: Preset): void {
    db.prepare(
      `INSERT INTO presets (id, kind, pipeline_id, name, values_json, created_at)
       VALUES (@id, @kind, @pipeline_id, @name, @values_json, @created_at)`,
    ).run({
      id: p.id,
      kind: p.kind,
      pipeline_id: p.pipelineId,
      name: p.name,
      values_json: JSON.stringify(p.data),
      created_at: p.createdAt,
    });
  },

  remove(id: string): void {
    db.prepare(`DELETE FROM presets WHERE id = ?`).run(id);
  },
};
