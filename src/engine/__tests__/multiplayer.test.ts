import { describe, expect, test } from 'bun:test';
import type { GameState, LevelState, LevelEdge, Player, Monster } from '../../domain/model.js';
import { applyAction, getPlayerById, handleTransition } from '../game.js';

function makeEmptyLevel(id: string, width: number, height: number): LevelState {
  return {
    id,
    depth: 1,
    width,
    height,
    tiles: Array(width * height).fill('OpenGround'),
    discovered: Array(width * height).fill(true),
    entities: [],
  };
}

function withTile(level: LevelState, x: number, y: number, kind: LevelState['tiles'][number]): LevelState {
  const idx = y * level.width + x;
  const tiles = [...level.tiles];
  tiles[idx] = kind;
  return { ...level, tiles };
}

function makeState(level: LevelState, levels: Record<string, { level: LevelState }>, edges: LevelEdge[], playerId: string): GameState {
  const worldLevels: GameState['world']['levels'] = {};
  for (const [id, entry] of Object.entries(levels)) {
    worldLevels[id] = { level: entry.level, coord: { x: 0, y: 0 }, compressedAt: 0 };
  }

  return {
    worldConfig: { themePrompt: 'test', seed: 'seed', difficulty: 'Normal', rulesVersion: '0.1.0' },
    seed: 123,
    world: { levels: worldLevels, edges, currentLevelId: level.id },
    currentLevel: level,
    playerId,
    turn: 0,
    messages: [],
    enemyFlavors: {},
    tileFlavors: {},
    roomDescription: 'Room',
  };
}

describe('multiplayer engine behavior', () => {
  test('handleTransition moves only the acting player; others remain on source level', () => {
    const fromLevelId = 'lvl-a';
    const toLevelId = 'lvl-b';

    let fromLevel = makeEmptyLevel(fromLevelId, 5, 5);
    fromLevel = withTile(fromLevel, 2, 2, 'Transition');

    const alice: Player = {
      id: 'p:alice',
      kind: 'Player',
      name: 'Alice',
      description: 'A traveler.',
      tokenChar: '@',
      position: { x: 2, y: 2 },
      hp: 20,
      maxHp: 20,
      strength: 10,
      agility: 10,
      intellect: 10,
      level: 1,
      xp: 0,
      xpToNext: 25,
    };
    const bob: Player = {
      id: 'p:bob',
      kind: 'Player',
      name: 'Bob',
      description: 'A traveler.',
      tokenChar: '@',
      position: { x: 3, y: 2 },
      hp: 20,
      maxHp: 20,
      strength: 10,
      agility: 10,
      intellect: 10,
      level: 1,
      xp: 0,
      xpToNext: 25,
    };

    fromLevel = { ...fromLevel, entities: [alice, bob] };

    const toLevel = makeEmptyLevel(toLevelId, 5, 5);
    const edges: LevelEdge[] = [
      {
        id: 'edge-1',
        fromLevelId,
        fromPosition: { x: 2, y: 2 },
        toLevelId,
        toPosition: { x: 1, y: 1 },
      },
    ];

    const state = makeState(fromLevel, { [fromLevelId]: { level: fromLevel }, [toLevelId]: { level: toLevel } }, edges, alice.id);

    const result = handleTransition(state, alice.id);
    expect(result.isNewLevel).toBe(false);
    expect(result.state.world.currentLevelId).toBe(toLevelId);

    // Only Alice should be on the destination level
    const destPlayers = result.state.currentLevel.entities.filter((e): e is Player => e.kind === 'Player');
    expect(destPlayers).toHaveLength(1);
    expect(destPlayers[0].id).toBe(alice.id);

    // Bob should remain on the source level (stored in world.levels)
    const storedOrigin = result.state.world.levels[fromLevelId]?.level;
    const originPlayers = storedOrigin?.entities.filter((e) => e.kind === 'Player') ?? [];
    expect(originPlayers).toHaveLength(1);
    expect(originPlayers[0].id).toBe(bob.id);

    // Message should reference the individual player, not "party"
    expect(result.state.messages.some((m) => m.text.includes('Alice traverses'))).toBe(true);

    // playerLocations should be updated for Alice
    expect(result.state.world.playerLocations?.[alice.id]?.levelId).toBe(toLevelId);
  });

  test('monsters target the closest player on their turn', () => {
    const levelId = 'lvl-1';
    let level = makeEmptyLevel(levelId, 5, 1);

    const far: Player = {
      id: 'p:far',
      kind: 'Player',
      name: 'Far',
      description: 'A traveler.',
      tokenChar: '@',
      position: { x: 0, y: 0 },
      hp: 20,
      maxHp: 20,
      strength: 10,
      agility: 10,
      intellect: 10,
      level: 1,
      xp: 0,
      xpToNext: 25,
    };
    const near: Player = {
      id: 'p:near',
      kind: 'Player',
      name: 'Near',
      description: 'A traveler.',
      tokenChar: '@',
      position: { x: 4, y: 0 },
      hp: 20,
      maxHp: 20,
      strength: 10,
      agility: 10,
      intellect: 10,
      level: 1,
      xp: 0,
      xpToNext: 25,
    };
    const monster: Monster = {
      id: 'm:1',
      kind: 'Monster',
      templateId: 'enemy-common-1',
      position: { x: 3, y: 0 },
      hp: 9,
      maxHp: 9,
    };

    level = { ...level, entities: [far, near, monster] };
    const state = makeState(level, { [levelId]: { level } }, [], far.id);

    const next = applyAction(state, far.id, { kind: 'Wait' });

    const farAfter = getPlayerById(next, far.id);
    const nearAfter = getPlayerById(next, near.id);

    expect(farAfter?.hp).toBe(20);
    expect(nearAfter?.hp).toBeLessThan(20);
  });
});
