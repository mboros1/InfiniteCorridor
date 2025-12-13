import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema.js';
import { RUNTIME_CONFIG } from '../config/runtime.js';

const worldDbDir = path.dirname(RUNTIME_CONFIG.worldDbPath);
fs.mkdirSync(worldDbDir, { recursive: true });

export const sqlite = new Database(RUNTIME_CONFIG.worldDbPath);

sqlite.exec('PRAGMA foreign_keys = ON;');

// Keep schema bootstrap minimal and idempotent so tests and first-run work without manual migrations.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    theme_prompt TEXT,
    seed TEXT,
    difficulty TEXT,
    state_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS players (
    player_id TEXT PRIMARY KEY,
    prompt TEXT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    token_char TEXT NOT NULL,
    token_color TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS players_last_used_idx ON players (last_used_at);

  CREATE TABLE IF NOT EXISTS levels (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    coord_x INTEGER NOT NULL,
    coord_y INTEGER NOT NULL,
    depth INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    state_json TEXT NOT NULL,
    tile_flavors_json TEXT,
    enemy_flavors_json TEXT,
    room_description TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS levels_world_coord_idx ON levels (world_id, coord_x, coord_y);

  CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    from_level_id TEXT NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    to_level_id TEXT NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    from_x INTEGER NOT NULL,
    from_y INTEGER NOT NULL,
    to_x INTEGER NOT NULL,
    to_y INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS edge_from_unique ON edges (world_id, from_level_id, from_x, from_y, to_level_id);
  CREATE INDEX IF NOT EXISTS edge_from_lookup ON edges (world_id, from_level_id, from_x, from_y);

  CREATE TABLE IF NOT EXISTS world_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS world_players_world_player_unique ON world_players (world_id, player_id);
  CREATE INDEX IF NOT EXISTS world_players_player_recent_idx ON world_players (player_id, last_seen_at);
  CREATE INDEX IF NOT EXISTS world_players_world_recent_idx ON world_players (world_id, last_seen_at);
`);

// Lightweight migrations for older DBs (CREATE TABLE IF NOT EXISTS won't add new columns).
try {
  sqlite.exec('ALTER TABLE players ADD COLUMN token_color TEXT;');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.toLowerCase().includes('duplicate column')) throw error;
}

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
