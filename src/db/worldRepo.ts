import { and, eq, sql } from 'drizzle-orm';
import { db } from './client.js';
import { edges, levels, worlds } from './schema.js';
import type { LevelCoord, LevelEdge, LevelState, EnemyFlavor, TileFlavor, TileKind, GameState } from '../domain/model.js';
import { APP_ERROR_CODE, appError } from '../errors/appError.js';
import {
  deserializeEnemyFlavors,
  deserializeLevel,
  deserializeTileFlavors,
  deserializeGameState,
  serializeEnemyFlavors,
  serializeLevel,
  serializeTileFlavors,
} from './serialization.js';
import { fromPromise, ok, tryCatch, type AppAsync } from '../utils/appResult.js';

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
}): AppAsync<void> {
  const result = await fromPromise(
    db
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
      }),
    (cause) =>
      appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to upsert world', {
        cause,
        context: { worldId: params.id },
      })
  );
  if (!result.ok) return result;
  return ok(undefined);
}

export async function getWorldState(worldId: string): AppAsync<GameState | null> {
  const rows = await fromPromise(
    db
      .select({
        stateJson: worlds.stateJson,
      })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1),
    (cause) =>
      appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to load world state', {
        cause,
        context: { worldId },
      })
  );
  if (!rows.ok) return rows;

  const stateJson = rows.value[0]?.stateJson;
  if (!stateJson) return ok(null);

  return tryCatch(
    () => deserializeGameState(stateJson),
    (cause) =>
      appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize world state', {
        cause,
        context: { worldId },
      })
  );
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
): AppAsync<void> {
  const serialized = tryCatch(
    () => serializeLevel(level),
    (cause) =>
      appError(APP_ERROR_CODE.DbSerializeFailed, 'Failed to serialize level state', {
        cause,
        context: { worldId, levelId: level.id, coord },
      })
  );
  if (!serialized.ok) return serialized;

  const tileFlavorsJson = tryCatch(
    () => serializeTileFlavors(flavor?.tileFlavors),
    (cause) =>
      appError(APP_ERROR_CODE.DbSerializeFailed, 'Failed to serialize tile flavors', {
        cause,
        context: { worldId, levelId: level.id, coord },
      })
  );
  if (!tileFlavorsJson.ok) return tileFlavorsJson;

  const enemyFlavorsJson = tryCatch(
    () => serializeEnemyFlavors(flavor?.enemyFlavors),
    (cause) =>
      appError(APP_ERROR_CODE.DbSerializeFailed, 'Failed to serialize enemy flavors', {
        cause,
        context: { worldId, levelId: level.id, coord },
      })
  );
  if (!enemyFlavorsJson.ok) return enemyFlavorsJson;

  const result = await fromPromise(
    db
      .insert(levels)
      .values({
        id: level.id,
        worldId,
        coordX: coord.x,
        coordY: coord.y,
        depth: level.depth,
        width: level.width,
        height: level.height,
        stateJson: serialized.value,
        tileFlavorsJson: tileFlavorsJson.value,
        enemyFlavorsJson: enemyFlavorsJson.value,
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
          stateJson: serialized.value,
          tileFlavorsJson: sql`coalesce(excluded.tile_flavors_json, levels.tile_flavors_json)`,
          enemyFlavorsJson: sql`coalesce(excluded.enemy_flavors_json, levels.enemy_flavors_json)`,
          roomDescription: sql`coalesce(excluded.room_description, levels.room_description)`,
          updatedAt: now(),
        },
      }),
    (cause) =>
      appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to upsert level state', {
        cause,
        context: { worldId, levelId: level.id, coord },
      })
  );
  if (!result.ok) return result;
  return ok(undefined);
}

export async function getLevelById(
  worldId: string,
  levelId: string
): AppAsync<{
  level: LevelState;
  flavor?: {
    tileFlavors?: Partial<Record<TileKind, TileFlavor>>;
    enemyFlavors?: Record<string, EnemyFlavor>;
    roomDescription?: string | null;
  };
} | null> {
  const rows = await fromPromise(
    db
      .select({
        stateJson: levels.stateJson,
        tileFlavorsJson: levels.tileFlavorsJson,
        enemyFlavorsJson: levels.enemyFlavorsJson,
        roomDescription: levels.roomDescription,
      })
      .from(levels)
      .where(and(eq(levels.worldId, worldId), eq(levels.id, levelId)))
      .limit(1),
    (cause) =>
      appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to load level by id', {
        cause,
        context: { worldId, levelId },
      })
  );
  if (!rows.ok) return rows;

  const row = rows.value[0];
  if (!row) return ok(null);

  const level = tryCatch(
    () => deserializeLevel(row.stateJson),
    (cause) =>
      appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize level state', {
        cause,
        context: { worldId, levelId },
      })
  );
  if (!level.ok) return level;

  const tileFlavors = tryCatch(
    () => deserializeTileFlavors(row.tileFlavorsJson),
    (cause) =>
      appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize tile flavors', {
        cause,
        context: { worldId, levelId },
      })
  );
  if (!tileFlavors.ok) return tileFlavors;

  const enemyFlavors = tryCatch(
    () => deserializeEnemyFlavors(row.enemyFlavorsJson),
    (cause) =>
      appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize enemy flavors', {
        cause,
        context: { worldId, levelId },
      })
  );
  if (!enemyFlavors.ok) return enemyFlavors;

  return ok({
    level: level.value,
    flavor: {
      tileFlavors: tileFlavors.value,
      enemyFlavors: enemyFlavors.value,
      roomDescription: row.roomDescription ?? undefined,
    },
  });
}

export async function getLevelByCoord(
  worldId: string,
  coord: LevelCoord
): AppAsync<{
  level: LevelState;
  flavor?: {
    tileFlavors?: Partial<Record<TileKind, TileFlavor>>;
    enemyFlavors?: Record<string, EnemyFlavor>;
    roomDescription?: string | null;
  };
} | null> {
  const rows = await fromPromise(
    db
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
      .limit(1),
    (cause) =>
      appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to load level by coord', {
        cause,
        context: { worldId, coord },
      })
  );
  if (!rows.ok) return rows;

  const row = rows.value[0];
  if (!row) return ok(null);

  const level = tryCatch(
    () => deserializeLevel(row.stateJson),
    (cause) =>
      appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize level state', {
        cause,
        context: { worldId, coord },
      })
  );
  if (!level.ok) return level;

  const tileFlavors = tryCatch(
    () => deserializeTileFlavors(row.tileFlavorsJson),
    (cause) =>
      appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize tile flavors', {
        cause,
        context: { worldId, coord },
      })
  );
  if (!tileFlavors.ok) return tileFlavors;

  const enemyFlavors = tryCatch(
    () => deserializeEnemyFlavors(row.enemyFlavorsJson),
    (cause) =>
      appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize enemy flavors', {
        cause,
        context: { worldId, coord },
      })
  );
  if (!enemyFlavors.ok) return enemyFlavors;

  return ok({
    level: level.value,
    flavor: {
      tileFlavors: tileFlavors.value,
      enemyFlavors: enemyFlavors.value,
      roomDescription: row.roomDescription ?? undefined,
    },
  });
}

// ---- Edge helpers ----

export async function upsertEdges(worldId: string, edgeList: LevelEdge[]): AppAsync<void> {
  if (edgeList.length === 0) return ok(undefined);
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

  const result = await fromPromise(
    db
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
      }),
    (cause) =>
      appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to upsert edges', {
        cause,
        context: { worldId, edgeCount: edgeList.length },
      })
  );
  if (!result.ok) return result;
  return ok(undefined);
}

export async function getEdgesFrom(
  worldId: string,
  fromLevelId: string,
  fromPosition?: { x: number; y: number }
): AppAsync<LevelEdge[]> {
  const conditions = [eq(edges.worldId, worldId), eq(edges.fromLevelId, fromLevelId)];
  if (fromPosition) {
    conditions.push(eq(edges.fromX, fromPosition.x), eq(edges.fromY, fromPosition.y));
  }

  const rows = await fromPromise(
    db
      .select({
        fromLevelId: edges.fromLevelId,
        toLevelId: edges.toLevelId,
        fromX: edges.fromX,
        fromY: edges.fromY,
        toX: edges.toX,
        toY: edges.toY,
      })
      .from(edges)
      .where(and(...conditions)),
    (cause) =>
      appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to load edges', {
        cause,
        context: { worldId, fromLevelId, fromPosition },
      })
  );
  if (!rows.ok) return rows;

  return ok(
    rows.value.map((row) => ({
      id: `${row.fromLevelId}-${row.fromX},${row.fromY}->${row.toLevelId}`,
      fromLevelId: row.fromLevelId,
      toLevelId: row.toLevelId,
      fromPosition: { x: row.fromX ?? 0, y: row.fromY ?? 0 },
      toPosition: { x: row.toX ?? 0, y: row.toY ?? 0 },
    }))
  );
}
