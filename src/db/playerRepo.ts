import { desc, eq } from 'drizzle-orm';
import { db } from './client.js';
import { players, worldPlayers, worlds } from './schema.js';
import { APP_ERROR_CODE, appError, type AppError } from '../errors/appError.js';
import { O, TE, pipe } from '../utils/fp.js';

function now(): number {
  return Date.now();
}

export type PlayerProfile = {
  playerId: string;
  prompt?: string | null;
  name: string;
  description: string;
  tokenChar: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
};

export type PlayerProfilePublic = {
  playerId: string;
  name: string;
  description: string;
  tokenChar: string;
};

export type PlayerProfileSummary = {
  playerId: string;
  name: string;
  tokenChar: string;
  lastUsedAt: number;
};

export type WorldSummary = {
  gameId: string;
  themePrompt?: string | null;
  seed?: string | null;
  difficulty?: string | null;
  createdAt: number;
  lastSeenAt?: number;
};

export function getPlayerProfile(playerId: string): TE.TaskEither<AppError, O.Option<PlayerProfile>> {
  return pipe(
    TE.tryCatch(
      () =>
        db
          .select({
            playerId: players.playerId,
            prompt: players.prompt,
            name: players.name,
            description: players.description,
            tokenChar: players.tokenChar,
            createdAt: players.createdAt,
            updatedAt: players.updatedAt,
            lastUsedAt: players.lastUsedAt,
          })
          .from(players)
          .where(eq(players.playerId, playerId))
          .limit(1),
      (cause) =>
        appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to load player profile', {
          cause,
          context: { playerId },
        })
    ),
    TE.map((rows) => {
      const row = rows[0];
      if (!row) return O.none;
      return O.some({
        playerId: row.playerId,
        prompt: row.prompt,
        name: row.name,
        description: row.description,
        tokenChar: row.tokenChar,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastUsedAt: row.lastUsedAt,
      });
    })
  );
}

export function upsertPlayerProfile(params: {
  playerId: string;
  prompt?: string | null;
  name: string;
  description: string;
  tokenChar: string;
}): TE.TaskEither<AppError, PlayerProfilePublic> {
  const ts = now();

  return pipe(
    TE.tryCatch(
      () =>
        db
          .insert(players)
          .values({
            playerId: params.playerId,
            prompt: params.prompt ?? null,
            name: params.name,
            description: params.description,
            tokenChar: params.tokenChar,
            createdAt: ts,
            updatedAt: ts,
            lastUsedAt: ts,
          })
          .onConflictDoUpdate({
            target: players.playerId,
            set: {
              prompt: params.prompt ?? null,
              name: params.name,
              description: params.description,
              tokenChar: params.tokenChar,
              updatedAt: ts,
              lastUsedAt: ts,
            },
          }),
      (cause) =>
        appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to upsert player profile', {
          cause,
          context: { playerId: params.playerId },
        })
    ),
    TE.map(() => ({
      playerId: params.playerId,
      name: params.name,
      description: params.description,
      tokenChar: params.tokenChar,
    }))
  );
}

export function touchPlayerLastUsed(playerId: string): TE.TaskEither<AppError, void> {
  const ts = now();
  return pipe(
    TE.tryCatch(
      () => db.update(players).set({ lastUsedAt: ts }).where(eq(players.playerId, playerId)),
      (cause) =>
        appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to update player last-used timestamp', {
          cause,
          context: { playerId },
        })
    ),
    TE.map(() => undefined)
  );
}

export function listPlayers(params?: { limit?: number }): TE.TaskEither<AppError, PlayerProfileSummary[]> {
  const limit = params?.limit ?? 20;
  return pipe(
    TE.tryCatch(
      () =>
        db
          .select({
            playerId: players.playerId,
            name: players.name,
            tokenChar: players.tokenChar,
            lastUsedAt: players.lastUsedAt,
          })
          .from(players)
          .orderBy(desc(players.lastUsedAt))
          .limit(limit),
      (cause) =>
        appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to list player profiles', {
          cause,
          context: { limit },
        })
    )
  );
}

export function touchWorldPlayer(params: {
  worldId: string;
  playerId: string;
}): TE.TaskEither<AppError, void> {
  const ts = now();
  return pipe(
    TE.tryCatch(
      () =>
        db
          .insert(worldPlayers)
          .values({
            worldId: params.worldId,
            playerId: params.playerId,
            joinedAt: ts,
            lastSeenAt: ts,
          })
          .onConflictDoUpdate({
            target: [worldPlayers.worldId, worldPlayers.playerId],
            set: {
              lastSeenAt: ts,
            },
          }),
      (cause) =>
        appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to upsert world player presence', {
          cause,
          context: { worldId: params.worldId, playerId: params.playerId },
        })
    ),
    TE.chain(() => touchPlayerLastUsed(params.playerId)),
    TE.map(() => undefined)
  );
}

export function listWorlds(params?: { limit?: number }): TE.TaskEither<AppError, WorldSummary[]> {
  const limit = params?.limit ?? 20;
  return pipe(
    TE.tryCatch(
      () =>
        db
          .select({
            gameId: worlds.id,
            themePrompt: worlds.themePrompt,
            seed: worlds.seed,
            difficulty: worlds.difficulty,
            createdAt: worlds.createdAt,
          })
          .from(worlds)
          .orderBy(desc(worlds.createdAt))
          .limit(limit),
      (cause) =>
        appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to list worlds', {
          cause,
          context: { limit },
        })
    )
  );
}

export function listWorldsForPlayer(params: {
  playerId: string;
  limit?: number;
}): TE.TaskEither<AppError, WorldSummary[]> {
  const limit = params.limit ?? 20;
  return pipe(
    TE.tryCatch(
      () =>
        db
          .select({
            gameId: worlds.id,
            themePrompt: worlds.themePrompt,
            seed: worlds.seed,
            difficulty: worlds.difficulty,
            createdAt: worlds.createdAt,
            lastSeenAt: worldPlayers.lastSeenAt,
          })
          .from(worldPlayers)
          .innerJoin(worlds, eq(worldPlayers.worldId, worlds.id))
          .where(eq(worldPlayers.playerId, params.playerId))
          .orderBy(desc(worldPlayers.lastSeenAt))
          .limit(limit),
      (cause) =>
        appError(APP_ERROR_CODE.DbQueryFailed, 'Failed to list worlds for player', {
          cause,
          context: { playerId: params.playerId, limit },
        })
    )
  );
}
