import { CONFIG } from '../config/index.js';
import { debugLog } from '../utils/debug.js';
import type { GameState, LevelState, Monster, MonsterSpawn, Entity } from '../domain/model.js';

export function initializeMonsterSpawns(level: LevelState, currentTurn = 0): LevelState {
  const monsters = level.entities.filter((entity): entity is Monster => entity.kind === 'Monster');
  if (monsters.length === 0) {
    return { ...level, monsterSpawns: [] };
  }

  const spawns = monsters.map((monster) => ({
    id: monster.id,
    templateId: monster.templateId,
    position: monster.position,
    maxHp: monster.maxHp,
    lastSpawnedTurn: currentTurn,
  }));

  return { ...level, monsterSpawns: spawns };
}

export function markMonsterSpawnDefeated(state: GameState, monsterId: string, turn: number): GameState {
  const level = state.currentLevel;
  const spawns = level.monsterSpawns;
  if (!spawns) return state;

  const spawnIndex = spawns.findIndex((entry) => entry.id === monsterId);
  if (spawnIndex === -1) return state;

  const updatedSpawns = [...spawns];
  updatedSpawns[spawnIndex] = { ...updatedSpawns[spawnIndex], lastDefeatedTurn: turn };

  return {
    ...state,
    currentLevel: {
      ...level,
      monsterSpawns: updatedSpawns,
    },
  };
}

export function respawnMonsters(state: GameState): GameState {
  const level = state.currentLevel;
  const spawns = level.monsterSpawns;
  if (!spawns || spawns.length === 0) return state;

  const respawnDelay = CONFIG.gameplay.monsterRespawnTurns;
  if (respawnDelay <= 0) return state;

  const now = state.turn;
  let entities: Entity[] = level.entities;
  let updatedSpawns: MonsterSpawn[] | undefined;
  let changed = false;

  for (let i = 0; i < spawns.length; i++) {
    const spawn = spawns[i];
    const alive = entities.some((entity) => entity.id === spawn.id && entity.kind === 'Monster');
    const spawnLog: Record<string, unknown> = {
      spawnId: spawn.id,
      templateId: spawn.templateId,
      turn: now,
      respawnDelay,
      alive,
      position: spawn.position,
    };

    if (typeof spawn.lastDefeatedTurn === 'number') {
      const elapsed = now - spawn.lastDefeatedTurn;
      spawnLog.elapsed = elapsed;
      spawnLog.timeLeft = Math.max(respawnDelay - elapsed, 0);
    }

    debugLog('[DEBUG] monster respawn tick', spawnLog);

    if (alive) continue;
    if (typeof spawn.lastDefeatedTurn !== 'number') continue;
    if (now - spawn.lastDefeatedTurn < respawnDelay) continue;
    const occupied = entities.some(
      (entity) => entity.position.x === spawn.position.x && entity.position.y === spawn.position.y
    );
    if (occupied) {
      debugLog('[DEBUG] monster respawn blocked by occupant', {
        spawnId: spawn.id,
        position: spawn.position,
        turn: now,
      });
      continue;
    }

    const monster: Monster = {
      id: spawn.id,
      kind: 'Monster',
      templateId: spawn.templateId,
      position: spawn.position,
      hp: spawn.maxHp,
      maxHp: spawn.maxHp,
    };

    entities = [...entities, monster];
    if (!updatedSpawns) updatedSpawns = spawns.slice();
    updatedSpawns[i] = { ...spawn, lastSpawnedTurn: now, lastDefeatedTurn: undefined };
    changed = true;
    debugLog('[DEBUG] monster respawned', {
      spawnId: spawn.id,
      position: spawn.position,
      templateId: spawn.templateId,
      turn: now,
    });
  }

  if (!changed || !updatedSpawns) return state;

  return {
    ...state,
    currentLevel: {
      ...level,
      entities,
      monsterSpawns: updatedSpawns,
    },
  };
}
