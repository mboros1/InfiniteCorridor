import { and, eq, sql } from 'drizzle-orm';
import { db } from './client.js';
import { edges, levels, worlds } from './schema.js';
import type { LevelCoord, LevelEdge, LevelState, EnemyFlavor, TileFlavor, TileKind, GameState } from '../domain/model.js';
import { APP_ERROR_CODE, appError, type AppError } from '../errors/appError.js';
import {
  deserializeEnemyFlavors,
  deserializeLevel,
  deserializeTileFlavors,
  deserializeGameState,
  serializeEnemyFlavors,
  serializeLevel,
  serializeTileFlavors,
} from './serialization.js';
import { E, O, TE, pipe } from '../utils/fp.js';

function now(): number {
  return Date.now();
}

export type LoadedLevel = {
  level: LevelState;
  flavor: {
    tileFlavors?: Partial<Record<TileKind, TileFlavor>>;
    enemyFlavors?: Record<string, EnemyFlavor>;
    roomDescription?: string;
  };
};

// ---- World helpers ----

export function upsertWorld(params: {
  id: string;
  themePrompt?: string | null;
  seed?: string | null;
  difficulty?: string | null;
  stateJson?: string | null;
}): TE.TaskEither<AppError, void> {
  return pipe(
    TE.tryCatch(
      () =>
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
    ),
    TE.map(() => undefined)
  );
}

export function getWorldState(worldId: string): TE.TaskEither<AppError, O.Option<GameState>> {
  return pipe(
    TE.tryCatch(
      () =>
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
    ),
    TE.chain((rows) => {
      const stateJson = rows[0]?.stateJson;
      if (!stateJson) return TE.right(O.none);

      return pipe(
        E.tryCatch(
          () => deserializeGameState(stateJson),
          (cause) =>
            appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize world state', {
              cause,
              context: { worldId },
            })
        ),
        TE.fromEither,
        TE.map(O.some)
      );
    })
  );
}

// ---- Level helpers ----

export function upsertLevelState(
  worldId: string,
  coord: LevelCoord,
  level: LevelState,
  flavor?: {
    tileFlavors?: Partial<Record<TileKind, TileFlavor>>;
    enemyFlavors?: Record<string, EnemyFlavor>;
    roomDescription?: string | null;
  }
): TE.TaskEither<AppError, void> {
  return pipe(
    TE.Do,
    TE.bind('serialized', () =>
      TE.fromEither(
        E.tryCatch(
          () => serializeLevel(level),
          (cause) =>
            appError(APP_ERROR_CODE.DbSerializeFailed, 'Failed to serialize level state', {
              cause,
              context: { worldId, levelId: level.id, coord },
            })
        )
      )
    ),
    TE.bind('tileFlavorsJson', () =>
      TE.fromEither(
        E.tryCatch(
          () => serializeTileFlavors(flavor?.tileFlavors),
          (cause) =>
            appError(APP_ERROR_CODE.DbSerializeFailed, 'Failed to serialize tile flavors', {
              cause,
              context: { worldId, levelId: level.id, coord },
            })
        )
      )
    ),
    TE.bind('enemyFlavorsJson', () =>
      TE.fromEither(
        E.tryCatch(
          () => serializeEnemyFlavors(flavor?.enemyFlavors),
          (cause) =>
            appError(APP_ERROR_CODE.DbSerializeFailed, 'Failed to serialize enemy flavors', {
              cause,
              context: { worldId, levelId: level.id, coord },
            })
        )
      )
    ),
    TE.chain(({ serialized, tileFlavorsJson, enemyFlavorsJson }) =>
      TE.tryCatch(
        () =>
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
            }),
        (cause) =>
          appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to upsert level state', {
            cause,
            context: { worldId, levelId: level.id, coord },
          })
      )
    ),
    TE.map(() => undefined)
  );
}

export function getLevelById(worldId: string, levelId: string): TE.TaskEither<AppError, O.Option<LoadedLevel>> {
  return pipe(
    TE.tryCatch(
      () =>
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
    ),
    TE.chain((rows) => {
      const row = rows[0];
      if (!row) return TE.right(O.none);

      return pipe(
        TE.Do,
        TE.bind('level', () =>
          TE.fromEither(
            E.tryCatch(
              () => deserializeLevel(row.stateJson),
              (cause) =>
                appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize level state', {
                  cause,
                  context: { worldId, levelId },
                })
            )
          )
        ),
        TE.bind('tileFlavors', () =>
          TE.fromEither(
            E.tryCatch(
              () => deserializeTileFlavors(row.tileFlavorsJson),
              (cause) =>
                appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize tile flavors', {
                  cause,
                  context: { worldId, levelId },
                })
            )
          )
        ),
        TE.bind('enemyFlavors', () =>
          TE.fromEither(
            E.tryCatch(
              () => deserializeEnemyFlavors(row.enemyFlavorsJson),
              (cause) =>
                appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize enemy flavors', {
                  cause,
                  context: { worldId, levelId },
                })
            )
          )
        ),
        TE.map(({ level, tileFlavors, enemyFlavors }) =>
          O.some({
            level,
            flavor: {
              tileFlavors,
              enemyFlavors,
              roomDescription: row.roomDescription ?? undefined,
            },
          })
        )
      );
    })
  );
}

export function getLevelByCoord(worldId: string, coord: LevelCoord): TE.TaskEither<AppError, O.Option<LoadedLevel>> {
  return pipe(
    TE.tryCatch(
      () =>
        db
          .select({
            stateJson: levels.stateJson,
            tileFlavorsJson: levels.tileFlavorsJson,
            enemyFlavorsJson: levels.enemyFlavorsJson,
            roomDescription: levels.roomDescription,
          })
          .from(levels)
          .where(and(eq(levels.worldId, worldId), eq(levels.coordX, coord.x), eq(levels.coordY, coord.y)))
          .limit(1),
      (cause) =>
        appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to load level by coord', {
          cause,
          context: { worldId, coord },
        })
    ),
    TE.chain((rows) => {
      const row = rows[0];
      if (!row) return TE.right(O.none);

      return pipe(
        TE.Do,
        TE.bind('level', () =>
          TE.fromEither(
            E.tryCatch(
              () => deserializeLevel(row.stateJson),
              (cause) =>
                appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize level state', {
                  cause,
                  context: { worldId, coord },
                })
            )
          )
        ),
        TE.bind('tileFlavors', () =>
          TE.fromEither(
            E.tryCatch(
              () => deserializeTileFlavors(row.tileFlavorsJson),
              (cause) =>
                appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize tile flavors', {
                  cause,
                  context: { worldId, coord },
                })
            )
          )
        ),
        TE.bind('enemyFlavors', () =>
          TE.fromEither(
            E.tryCatch(
              () => deserializeEnemyFlavors(row.enemyFlavorsJson),
              (cause) =>
                appError(APP_ERROR_CODE.DbDeserializeFailed, 'Failed to deserialize enemy flavors', {
                  cause,
                  context: { worldId, coord },
                })
            )
          )
        ),
        TE.map(({ level, tileFlavors, enemyFlavors }) =>
          O.some({
            level,
            flavor: {
              tileFlavors,
              enemyFlavors,
              roomDescription: row.roomDescription ?? undefined,
            },
          })
        )
      );
    })
  );
}

// ---- Edge helpers ----

export function upsertEdges(worldId: string, edgeList: LevelEdge[]): TE.TaskEither<AppError, void> {
  if (edgeList.length === 0) return TE.right(undefined);
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

  return pipe(
    TE.tryCatch(
      () =>
        db
          .insert(edges)
          .values(values)
          .onConflictDoUpdate({
            target: [edges.worldId, edges.fromLevelId, edges.fromX, edges.fromY, edges.toLevelId],
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
    ),
    TE.map(() => undefined)
  );
}

export function getEdgesFrom(
  worldId: string,
  fromLevelId: string,
  fromPosition?: { x: number; y: number }
): TE.TaskEither<AppError, LevelEdge[]> {
  const conditions = [eq(edges.worldId, worldId), eq(edges.fromLevelId, fromLevelId)];
  if (fromPosition) {
    conditions.push(eq(edges.fromX, fromPosition.x), eq(edges.fromY, fromPosition.y));
  }

  return pipe(
    TE.tryCatch(
      () =>
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
    ),
    TE.map((rows) =>
      rows.map((row) => ({
        id: `${row.fromLevelId}-${row.fromX},${row.fromY}->${row.toLevelId}`,
        fromLevelId: row.fromLevelId,
        toLevelId: row.toLevelId,
        fromPosition: { x: row.fromX ?? 0, y: row.fromY ?? 0 },
        toPosition: { x: row.toX ?? 0, y: row.toY ?? 0 },
      }))
    )
  );
}
