import { describe, expect, test } from 'bun:test';
import type { GameState, LevelState, Player } from '../../domain/model.js';
import { ensurePlayerInGame } from '../players.js';

function makeLevel(entities: LevelState['entities']): LevelState {
  return {
    id: 'lvl-1',
    depth: 1,
    width: 3,
    height: 3,
    tiles: Array(9).fill('OpenGround'),
    discovered: Array(9).fill(false),
    entities,
  };
}

function makeState(level: LevelState, playerId: string): GameState {
  return {
    worldConfig: {
      themePrompt: 'test',
      seed: 'seed',
      difficulty: 'Normal',
      rulesVersion: '0.1.0',
    },
    seed: 123,
    world: {
      levels: {
        'lvl-1': {
          level,
          coord: { x: 0, y: 0 },
          compressedAt: 0,
        },
      },
      edges: [],
      currentLevelId: 'lvl-1',
    },
    currentLevel: level,
    playerId,
    turn: 0,
    messages: [],
    enemyFlavors: {},
    tileFlavors: {},
    roomDescription: 'Room',
  };
}

describe('ensurePlayerInGame', () => {
  test('remaps legacy single-player id to p:<playerId> on bootstrap', () => {
    const legacyPlayer: Player = {
      id: 'player-1',
      kind: 'Player',
      name: 'Unnamed Wanderer',
      description: 'A traveler.',
      tokenChar: '@',
      position: { x: 1, y: 1 },
      hp: 20,
      maxHp: 20,
      strength: 10,
      agility: 10,
      intellect: 10,
      level: 1,
      xp: 0,
      xpToNext: 25,
    };
    const level = makeLevel([legacyPlayer]);
    const state = makeState(level, 'player-1');

    const result = ensurePlayerInGame(state, {
      playerId: '00000000-0000-0000-0000-000000000001',
      playerName: 'Alice',
    });

    expect(result.playerEntityId).toBe('p:00000000-0000-0000-0000-000000000001');
    expect(result.state.playerId).toBe(result.playerEntityId);
    expect(result.state.currentLevel.entities.filter((e) => e.kind === 'Player')).toHaveLength(1);
    expect((result.state.currentLevel.entities[0] as Player).id).toBe(result.playerEntityId);
    expect((result.state.currentLevel.entities[0] as Player).name).toBe('Alice');
  });

  test('adds a new player entity when missing and syncs world.currentLevel', () => {
    const existingPlayer: Player = {
      id: 'p:00000000-0000-0000-0000-000000000001',
      kind: 'Player',
      name: 'Alice',
      description: 'A traveler.',
      tokenChar: '@',
      position: { x: 1, y: 1 },
      hp: 20,
      maxHp: 20,
      strength: 10,
      agility: 10,
      intellect: 10,
      level: 1,
      xp: 0,
      xpToNext: 25,
    };
    const level = makeLevel([existingPlayer]);
    const state = makeState(level, existingPlayer.id);

    const result = ensurePlayerInGame(state, {
      playerId: '00000000-0000-0000-0000-000000000002',
      playerName: 'Bob',
    });

    const players = result.state.currentLevel.entities.filter((e): e is Player => e.kind === 'Player');
    expect(players).toHaveLength(2);
    expect(players.some((p) => p.id === 'p:00000000-0000-0000-0000-000000000002')).toBe(true);
    expect(players.some((p) => p.name === 'Bob')).toBe(true);

    const stored = result.state.world.levels[result.state.world.currentLevelId];
    expect(stored).toBeDefined();
    expect(stored.level.entities.filter((e) => e.kind === 'Player')).toHaveLength(2);
    expect(result.state.messages.some((m) => m.text.includes('joins the corridor'))).toBe(true);
  });
});
