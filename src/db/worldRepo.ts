import { and, eq, sql } from 'drizzle-orm';
import { db } from './client.js';
import { edges, levels, worlds } from './schema.js';
import type { LevelCoord, LevelEdge, LevelState, EnemyFlavor, TileFlavor, TileKind, GameState } from '../domain/model.js';
import {
  deserializeEnemyFlavors,
  deserializeLevel,
  deserializeTileFlavors,
  deserializeGameState,
  serializeEnemyFlavors,
  serializeLevel,
  serializeTileFlavors,
} from './serialization.js';

function now(): number {
  return Date.now();
}

// ---- World helpers ----

export async function upsertWorld(params: {
  id: string;
  themePrompt?: string | null;
  seed?: string | null;
  difficulty?: string | null;
  stateJson?: string | null;
}): Promise<void> {
  await db
    .insert(worlds)
    .values({
      id: params.id,
      themePrompt: params.themePrompt ?? null,
      seed: params.seed ?? null,
      difficulty: params.difficulty ?? null,
      stateJson: params.stateJson ?? null,
      createdAt: now(),
    })
    .onConflictDoUpdate({
      target: worlds.id,
      set: {
        themePrompt: params.themePrompt ?? null,
        seed: params.seed ?? null,
        difficulty: params.difficulty ?? null,
        stateJson: params.stateJson ?? sql`coalesce(worlds.state_json, NULL)`,
      },
    });
}

export async function getWorldState(worldId: string): Promise<GameState | null> {
  const rows = await db
    .select({
      stateJson: worlds.stateJson,
    })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1);

  if (!rows[0]?.stateJson) return null;
  return deserializeGameState(rows[0].stateJson);
}

// ---- Level helpers ----

export async function upsertLevelState(
  worldId: string,
  coord: LevelCoord,
  level: LevelState,
  flavor?: {
    tileFlavors?: Partial<Record<TileKind, TileFlavor>>;
    enemyFlavors?: Record<string, EnemyFlavor>;
    roomDescription?: string | null;
  }
): Promise<void> {
  const serialized = serializeLevel(level);
  const tileFlavorsJson = serializeTileFlavors(flavor?.tileFlavors);
  const enemyFlavorsJson = serializeEnemyFlavors(flavor?.enemyFlavors);
  await db
    .insert(levels)
    .values({
      id: level.id,
      worldId,
      coordX: coord.x,
      coordY: coord.y,
      depth: level.depth,
      width: level.width,
      height: level.height,
      stateJson: serialized,
      tileFlavorsJson,
      enemyFlavorsJson,
      roomDescription: flavor?.roomDescription ?? null,
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: levels.id,
      set: {
        coordX: coord.x,
        coordY: coord.y,
        depth: level.depth,
        width: level.width,
        height: level.height,
        stateJson: serialized,
        tileFlavorsJson: sql`coalesce(excluded.tile_flavors_json, levels.tile_flavors_json)`,
        enemyFlavorsJson: sql`coalesce(excluded.enemy_flavors_json, levels.enemy_flavors_json)`,
        roomDescription: sql`coalesce(excluded.room_description, levels.room_description)`,
        updatedAt: now(),
      },
    });
}

export async function getLevelById(
  worldId: string,
  levelId: string
): Promise<{ level: LevelState; flavor?: { tileFlavors?: Partial<Record<TileKind, TileFlavor>>; enemyFlavors?: Record<string, EnemyFlavor>; roomDescription?: string | null } } | null> {
  const rows = await db
    .select({
      stateJson: levels.stateJson,
      tileFlavorsJson: levels.tileFlavorsJson,
      enemyFlavorsJson: levels.enemyFlavorsJson,
      roomDescription: levels.roomDescription,
    })
    .from(levels)
    .where(and(eq(levels.worldId, worldId), eq(levels.id, levelId)))
    .limit(1);

  if (!rows[0]) return null;
  return {
    level: deserializeLevel(rows[0].stateJson),
    flavor: {
      tileFlavors: deserializeTileFlavors(rows[0].tileFlavorsJson),
      enemyFlavors: deserializeEnemyFlavors(rows[0].enemyFlavorsJson),
      roomDescription: rows[0].roomDescription ?? undefined,
    },
  };
}

export async function getLevelByCoord(
  worldId: string,
  coord: LevelCoord
): Promise<{ level: LevelState; flavor?: { tileFlavors?: Partial<Record<TileKind, TileFlavor>>; enemyFlavors?: Record<string, EnemyFlavor>; roomDescription?: string | null } } | null> {
  const rows = await db
    .select({
      stateJson: levels.stateJson,
      tileFlavorsJson: levels.tileFlavorsJson,
      enemyFlavorsJson: levels.enemyFlavorsJson,
      roomDescription: levels.roomDescription,
    })
    .from(levels)
    .where(
      and(eq(levels.worldId, worldId), eq(levels.coordX, coord.x), eq(levels.coordY, coord.y))
    )
    .limit(1);

  if (!rows[0]) return null;
  return {
    level: deserializeLevel(rows[0].stateJson),
    flavor: {
      tileFlavors: deserializeTileFlavors(rows[0].tileFlavorsJson),
      enemyFlavors: deserializeEnemyFlavors(rows[0].enemyFlavorsJson),
      roomDescription: rows[0].roomDescription ?? undefined,
    },
  };
}

// ---- Edge helpers ----

export async function upsertEdges(worldId: string, edgeList: LevelEdge[]): Promise<void> {
  if (edgeList.length === 0) return;
  const timestamp = now();

  const values = edgeList.map((edge) => ({
    worldId,
    fromLevelId: edge.fromLevelId,
    toLevelId: edge.toLevelId,
    fromX: edge.fromPosition.x,
    fromY: edge.fromPosition.y,
    toX: edge.toPosition.x,
    toY: edge.toPosition.y,
    createdAt: timestamp,
  }));

  await db
    .insert(edges)
    .values(values)
    .onConflictDoUpdate({
      target: [
        edges.worldId,
        edges.fromLevelId,
        edges.fromX,
        edges.fromY,
        edges.toLevelId,
      ],
      set: {
        toX: sql`excluded.to_x`,
        toY: sql`excluded.to_y`,
        createdAt: sql`excluded.created_at`,
      },
    });
}

export async function getEdgesFrom(
  worldId: string,
  fromLevelId: string,
  fromPosition?: { x: number; y: number }
): Promise<LevelEdge[]> {
  const conditions = [eq(edges.worldId, worldId), eq(edges.fromLevelId, fromLevelId)];
  if (fromPosition) {
    conditions.push(eq(edges.fromX, fromPosition.x), eq(edges.fromY, fromPosition.y));
  }

  const rows = await db
    .select({
      fromLevelId: edges.fromLevelId,
      toLevelId: edges.toLevelId,
      fromX: edges.fromX,
      fromY: edges.fromY,
      toX: edges.toX,
      toY: edges.toY,
    })
    .from(edges)
    .where(and(...conditions));

  return rows.map((row) => ({
    id: `${row.fromLevelId}-${row.fromX},${row.fromY}->${row.toLevelId}`,
    fromLevelId: row.fromLevelId,
    toLevelId: row.toLevelId,
    fromPosition: { x: row.fromX ?? 0, y: row.fromY ?? 0 },
    toPosition: { x: row.toX ?? 0, y: row.toY ?? 0 },
  }));
}
