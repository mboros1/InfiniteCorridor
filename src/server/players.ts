import type { EntityId, GameState, LevelState, Player, Position } from '../domain/model.js';
import { isWalkable } from '../domain/tiles.js';
import { playerEntityId } from '../domain/ids.js';
import { addMessage, getEntityAt, getTile, updateFov } from '../engine/game.js';
import { CONFIG } from '../config/index.js';

export interface EnsurePlayerProfile {
  name: string;
  description: string;
  tokenChar: string;
  tokenColor?: string;
}

export interface EnsurePlayerOptions {
  playerId: string;
  profile?: EnsurePlayerProfile;
  // Legacy/interop: prefer `profile`, but accept a name override if present.
  playerName?: string;
}

export interface EnsurePlayerResult {
  state: GameState;
  playerEntityId: EntityId;
}

function listPlayers(level: LevelState): Player[] {
  return level.entities.filter((e): e is Player => e.kind === 'Player');
}

function isSpawnable(level: LevelState, pos: Position): boolean {
  const tile = getTile(level, pos.x, pos.y);
  if (!isWalkable(tile)) return false;
  return getEntityAt(level, pos.x, pos.y) === undefined;
}

function clampPosition(level: LevelState, pos: Position): Position {
  return {
    x: Math.max(0, Math.min(pos.x, level.width - 1)),
    y: Math.max(0, Math.min(pos.y, level.height - 1)),
  };
}

function findSpawnPosition(level: LevelState, near?: Position): Position | null {
  const start = clampPosition(level, near ?? { x: Math.floor(level.width / 2), y: Math.floor(level.height / 2) });
  const key = (p: Position) => `${p.x},${p.y}`;

  const queue: Position[] = [start];
  const visited = new Set<string>([key(start)]);

  const deltas: Position[] = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    if (isSpawnable(level, current)) return current;

    for (const delta of deltas) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      if (next.x < 0 || next.x >= level.width || next.y < 0 || next.y >= level.height) continue;

      const nextKey = key(next);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      queue.push(next);
    }
  }

  return null;
}

function defaultPlayer(name: string, position: Position, id: EntityId): Player {
  return {
    id,
    kind: 'Player',
    name,
    description: 'A traveler of the infinite corridor.',
    tokenChar: '@',
    position,
    hp: 20,
    maxHp: 20,
    strength: 10,
    agility: 10,
    intellect: 10,
    level: 1,
    xp: 0,
    xpToNext: 25,
  };
}

function applyProfileIfProvided(player: Player, options: EnsurePlayerOptions): Player {
  const name = options.profile?.name ?? options.playerName?.trim();
  const description = options.profile?.description;
  const tokenChar = options.profile?.tokenChar;
  const tokenColor = options.profile?.tokenColor;

  let updated = player;
  if (name && name !== updated.name) updated = { ...updated, name };
  if (description && description !== updated.description) updated = { ...updated, description };
  if (tokenChar && tokenChar !== updated.tokenChar) updated = { ...updated, tokenChar };
  if (tokenColor && tokenColor !== updated.tokenColor) updated = { ...updated, tokenColor };
  return updated;
}

function replaceEntityIdAndProfile(level: LevelState, fromId: EntityId, toId: EntityId, options: EnsurePlayerOptions): LevelState {
  const entities = level.entities.map((e) => {
    if (e.id !== fromId) return e;
    if (e.kind !== 'Player') return e;
    return applyProfileIfProvided({ ...e, id: toId }, options);
  });
  return { ...level, entities };
}

function upsertPlayerEntity(level: LevelState, player: Player): LevelState {
  const existingIndex = level.entities.findIndex((e) => e.id === player.id);
  if (existingIndex === -1) {
    return { ...level, entities: [...level.entities, player] };
  }
  const entities = [...level.entities];
  entities[existingIndex] = player;
  return { ...level, entities };
}

function syncCurrentLevelToWorld(state: GameState, currentLevel: LevelState): GameState {
  const currentLevelId = state.world.currentLevelId;
  const stored = state.world.levels[currentLevelId];
  if (!stored) return { ...state, currentLevel };
  return {
    ...state,
    currentLevel,
    world: {
      ...state.world,
      levels: {
        ...state.world.levels,
        [currentLevelId]: {
          ...stored,
          level: currentLevel,
        },
      },
    },
  };
}

export function ensurePlayerInGame(state: GameState, options: EnsurePlayerOptions): EnsurePlayerResult {
  const desiredEntityId = playerEntityId(options.playerId);
  const currentLevel = state.currentLevel;

  const existing = currentLevel.entities.find(
    (e) => e.kind === 'Player' && e.id === desiredEntityId
  ) as Player | undefined;

  if (existing) {
    const updated = applyProfileIfProvided(existing, options);
    if (updated === existing) return { state, playerEntityId: desiredEntityId };

    const updatedLevel = upsertPlayerEntity(currentLevel, updated);
    return {
      state: syncCurrentLevelToWorld(state, updatedLevel),
      playerEntityId: desiredEntityId,
    };
  }

  const players = listPlayers(currentLevel);
  const isLegacyBootstrap =
    players.length === 1 &&
    players[0] &&
    players[0].id === state.playerId &&
    !state.playerId.startsWith('p:') &&
    state.playerId !== desiredEntityId;

  if (isLegacyBootstrap) {
    const remappedLevel = replaceEntityIdAndProfile(currentLevel, state.playerId, desiredEntityId, options);
    const remappedState = syncCurrentLevelToWorld({ ...state, playerId: desiredEntityId }, remappedLevel);
    return { state: remappedState, playerEntityId: desiredEntityId };
  }

  const preferredNear = players[0]?.position;
  const spawnPos = findSpawnPosition(currentLevel, preferredNear);
  if (!spawnPos) {
    return {
      state: addMessage(state, 'No safe spawn location found for a new player.', 'system'),
      playerEntityId: desiredEntityId,
    };
  }

  const name = options.profile?.name ?? options.playerName?.trim() ?? `Wanderer-${options.playerId.slice(0, 6)}`;
  const newPlayer = applyProfileIfProvided(defaultPlayer(name, spawnPos, desiredEntityId), options);

  const withPlayer = upsertPlayerEntity(currentLevel, newPlayer);
  const withFov = updateFov(withPlayer, spawnPos, CONFIG.gameplay.playerFovRadius);
  let next = syncCurrentLevelToWorld(state, withFov);
  next = addMessage(next, `${newPlayer.name} joins the corridor.`, 'system');

  return { state: next, playerEntityId: desiredEntityId };
}
