import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.js';

const dbFile = process.env.WORLD_DB_PATH ?? 'world.db';

const sqlite = new Database(dbFile);

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
