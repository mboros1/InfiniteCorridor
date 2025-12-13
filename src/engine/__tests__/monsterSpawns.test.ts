import { describe, expect, test } from 'bun:test';
import {
  initializeMonsterSpawns,
  markMonsterSpawnDefeated,
  respawnMonsters,
} from '../../engine/monsterSpawns.js';
import type {
  Entity,
  GameState,
  LevelState,
  Monster,
  MonsterSpawn,
  Player,
  Position,
  WorldState,
} from '../../domain/model.js';
import { CONFIG } from '../../config/index.js';

function createLevel(entities: Entity[]): LevelState {
  const width = 5;
  const height = 5;
  return {
    id: 'level-test',
    depth: 1,
    width,
    height,
    tiles: Array(width * height).fill('OpenGround'),
    discovered: Array(width * height).fill(true),
    entities,
  };
}

function makePlayer(id: string, position: Position): Player {
  return {
    id,
    kind: 'Player',
    name: 'Test',
    description: 'Test player',
    tokenChar: '@',
    tokenColor: '#00ff00',
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

function makeMonster(id: string, position: Position): Monster {
  return {
    id,
    kind: 'Monster',
    templateId: 'enemy-common-1',
    position,
    hp: 8,
    maxHp: 8,
  };
}

function createGameState(level: LevelState, turn = 0): GameState {
  const world: WorldState = {
    levels: {
      [level.id]: {
        level,
        coord: { x: 0, y: 0 },
        compressedAt: 0,
      },
    },
    edges: [],
    currentLevelId: level.id,
  };

  const player = level.entities.find((e): e is Player => e.kind === 'Player');
  const playerId = player ? player.id : 'player-1';

  return {
    worldConfig: {
      themePrompt: 'test',
      seed: 'seed',
      difficulty: 'Normal',
      rulesVersion: '0.1.0',
    },
    seed: 1,
    world,
    currentLevel: level,
    playerId,
    turn,
    messages: [],
    enemyFlavors: {},
    tileFlavors: {},
  };
}

describe('monster spawn helpers', () => {
  test('initializes spawn entries for each monster', () => {
    const player = makePlayer('p-1', { x: 1, y: 1 });
    const monster = makeMonster('m-1', { x: 2, y: 2 });
    const level = createLevel([player, monster]);

    const populated = initializeMonsterSpawns(level, 5);
    expect(populated.monsterSpawns).toHaveLength(1);
    expect(populated.monsterSpawns?.[0]).toMatchObject({
      id: 'm-1',
      templateId: 'enemy-common-1',
      position: { x: 2, y: 2 },
      maxHp: 8,
      lastSpawnedTurn: 5,
    });
  });

  test('marks spawn defeated turn when monster dies', () => {
    const player = makePlayer('p-1', { x: 1, y: 1 });
    const level = createLevel([player]);
    const spawn: MonsterSpawn = {
      id: 'm-2',
      templateId: 'enemy-common-1',
      position: { x: 2, y: 2 },
      maxHp: 8,
      lastSpawnedTurn: 0,
    };
    const levelWithSpawns = { ...level, monsterSpawns: [spawn] };

    const state = createGameState(levelWithSpawns, 3);
    const next = markMonsterSpawnDefeated(state, 'm-2', 3);

    expect(next.currentLevel.monsterSpawns?.[0].lastDefeatedTurn).toBe(3);
  });

  test('respawns monster after configured delay', () => {
    const player = makePlayer('p-1', { x: 0, y: 0 });
    const spawn: MonsterSpawn = {
      id: 'm-3',
      templateId: 'enemy-common-1',
      position: { x: 2, y: 2 },
      maxHp: 8,
      lastSpawnedTurn: 0,
      lastDefeatedTurn: 0,
    };
    const level = createLevel([player]);
    const levelWithSpawns = { ...level, monsterSpawns: [spawn] };

    const state = createGameState(levelWithSpawns, CONFIG.gameplay.monsterRespawnTurns + 1);
    const next = respawnMonsters(state);

    expect(next.currentLevel.entities.some((entity) => entity.id === 'm-3' && entity.kind === 'Monster')).toBe(true);
    expect(next.currentLevel.monsterSpawns?.[0].lastDefeatedTurn).toBeUndefined();
    expect(next.currentLevel.monsterSpawns?.[0].lastSpawnedTurn).toBe(CONFIG.gameplay.monsterRespawnTurns + 1);
  });
});
