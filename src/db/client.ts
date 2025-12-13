import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.js';
import { RUNTIME_CONFIG } from '../config/runtime.js';

const sqlite = new Database(RUNTIME_CONFIG.worldDbPath);

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
