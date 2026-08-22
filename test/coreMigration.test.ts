import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateStudioProjectsToAlbums } from "../backend/src/core-migration.ts";

test("Studio user projects become albums while system projects stay dormant", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, system_kind TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE generations (
      id TEXT PRIMARY KEY, project_id TEXT, created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE collection_items (
      collection_id TEXT NOT NULL, generation_id TEXT NOT NULL, added_at TEXT NOT NULL,
      PRIMARY KEY (collection_id, generation_id)
    );
    INSERT INTO projects VALUES
      ('personal', 'Portrait study', NULL, '2026-01-01T00:00:00.000Z'),
      ('quick', 'Quick Creates', 'quick', '2026-01-01T00:00:00.000Z');
    INSERT INTO generations VALUES
      ('personal-gen', 'personal', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
      ('quick-gen', 'quick', '2026-01-02T00:00:00.000Z', NULL);
  `);

  assert.equal(migrateStudioProjectsToAlbums(db), 1);
  assert.deepEqual(db.prepare(`SELECT id, name FROM collections`).all(), [
    { id: "album_project_personal", name: "Portrait study" },
  ]);
  assert.deepEqual(db.prepare(`SELECT * FROM collection_items`).all(), [
    {
      collection_id: "album_project_personal",
      generation_id: "personal-gen",
      added_at: "2026-01-03T00:00:00.000Z",
    },
  ]);
  assert.equal(migrateStudioProjectsToAlbums(db), 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM collection_items`).get() as { count: number }).count, 1);
  db.close();
});

test("Core-only databases make the compatibility migration a no-op", () => {
  const db = new Database(":memory:");
  assert.equal(migrateStudioProjectsToAlbums(db), 0);
  db.close();
});
