import type Database from "better-sqlite3";

/**
 * Preserve user-created Studio projects as Core albums. Studio's system
 * projects are implementation details and intentionally stay dormant.
 */
export function migrateStudioProjectsToAlbums(db: Database.Database): number {
  const hasProjects = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'`)
    .get();
  if (!hasProjects) return 0;

  const generationColumns = db.prepare(`PRAGMA table_info(generations)`).all() as { name: string }[];
  if (!generationColumns.some((column) => column.name === "project_id")) return 0;

  const insertAlbums = db.prepare(`
    INSERT OR IGNORE INTO collections (id, name, created_at)
    SELECT 'album_project_' || id, name, created_at
      FROM projects
     WHERE system_kind IS NULL
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO collection_items (collection_id, generation_id, added_at)
    SELECT 'album_project_' || p.id, g.id, COALESCE(g.completed_at, g.created_at)
      FROM generations g
      JOIN projects p ON p.id = g.project_id
     WHERE p.system_kind IS NULL
  `).run();

  return insertAlbums.changes;
}
