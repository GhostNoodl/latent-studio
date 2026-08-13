import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

test("legacy databases are backed up and migrated without canceling queued work", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "latent-migration-test-"));
  const path = join(dataDir, "latent.db");
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE workflows (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      workflow TEXT NOT NULL, params TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE presets (
      id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, name TEXT NOT NULL,
      values_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE generations (
      id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, pipeline_name TEXT NOT NULL,
      pipeline_type TEXT NOT NULL, status TEXT NOT NULL, prompt_id TEXT, seed INTEGER,
      params TEXT NOT NULL, outputs TEXT NOT NULL, thumbnail TEXT,
      favorite INTEGER NOT NULL DEFAULT 0, rating INTEGER, error TEXT,
      created_at TEXT NOT NULL, completed_at TEXT
    );
    INSERT INTO generations (
      id, pipeline_id, pipeline_name, pipeline_type, status, prompt_id,
      params, outputs, created_at
    ) VALUES (
      'recover-me', 'pipe', 'Legacy', 'image', 'queued', 'prompt-1',
      '{}', '[]', '2026-01-01T00:00:00.000Z'
    );
  `);
  legacy.close();

  process.env.DATA_DIR = dataDir;
  const { db } = await import("../backend/src/db.ts");
  assert.equal(db.pragma("user_version", { simple: true }), 3);
  const workflowColumns = db.prepare("PRAGMA table_info(workflows)").all() as { name: string }[];
  assert.ok(workflowColumns.some((column) => column.name === "base_group"));
  const pipelineColumn = (db.prepare("PRAGMA table_info(presets)").all() as { name: string; notnull: number }[])
    .find((column) => column.name === "pipeline_id");
  assert.equal(pipelineColumn?.notnull, 0);
  const queued = db.prepare("SELECT status FROM generations WHERE id = 'recover-me'").get() as { status: string };
  assert.equal(queued.status, "queued");
  assert.ok(readdirSync(dataDir).some((name) => /^latent-v0-pre-v3-.*\.db$/.test(name)));

  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});
