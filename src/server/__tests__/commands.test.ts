import { describe, expect, test } from 'bun:test';
import type { GameState, LevelState } from '../../domain/model.js';
import { applyCommand, parseCommandText } from '../commands.js';

function makeState(): GameState {
  const level: LevelState = {
    id: 'lvl-1',
    depth: 1,
    width: 2,
    height: 2,
    tiles: ['OpenGround', 'OpenGround', 'OpenGround', 'OpenGround'],
    discovered: [true, true, true, true],
    entities: [
      {
        id: 'player-1',
        kind: 'Player',
        name: 'Hero',
        description: 'A traveler.',
        tokenChar: '@',
        position: { x: 0, y: 0 },
        hp: 10,
        maxHp: 10,
        strength: 10,
        agility: 10,
        intellect: 10,
        level: 1,
        xp: 0,
        xpToNext: 25,
      },
      {
        id: 'monster-1',
        kind: 'Monster',
        templateId: 'enemy-common-1',
        position: { x: 1, y: 0 },
        hp: 5,
        maxHp: 5,
      },
      {
        id: 'item-1',
        kind: 'Item',
        name: 'Potion',
        position: { x: 1, y: 1 },
      },
    ],
  };

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
    playerId: 'player-1',
    turn: 5,
    messages: [],
    enemyFlavors: {
      'enemy-common-1': { name: 'Goblin', shortDescription: 'Small and mean' },
    },
    tileFlavors: {},
    roomDescription: 'A test room',
  };
}

describe('server command parsing', () => {
  test('parseCommandText parses /say', () => {
    expect(parseCommandText('/say hello')).toEqual({ kind: 'Say', message: 'hello' });
  });

  test('parseCommandText parses /look and /who', () => {
    expect(parseCommandText('/look')).toEqual({ kind: 'Look' });
    expect(parseCommandText('/who')).toEqual({ kind: 'Who' });
  });

  test('parseCommandText treats empty input as Empty', () => {
    expect(parseCommandText('')).toEqual({ kind: 'Empty' });
    expect(parseCommandText('   ')).toEqual({ kind: 'Empty' });
    expect(parseCommandText('/')).toEqual({ kind: 'Empty' });
  });
});

describe('server command application', () => {
  test('/say adds a chat message and does not advance turn', () => {
    const state = makeState();
    const next = applyCommand(state, '/say hello');

    expect(next.turn).toBe(state.turn);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].kind).toBe('chat');
    expect(next.messages[0].text).toBe('Hero: hello');
  });

  test('/look adds description + roster messages', () => {
    const state = makeState();
    const next = applyCommand(state, '/look');

    expect(next.messages).toHaveLength(2);
    expect(next.messages[0].kind).toBe('system');
    expect(next.messages[0].text).toBe('A test room');

    expect(next.messages[1].kind).toBe('system');
    expect(next.messages[1].text).toContain('Players: Hero');
    expect(next.messages[1].text).toContain('Hostiles: Goblin');
    expect(next.messages[1].text).toContain('Items: Potion');
  });

  test('/who lists players', () => {
    const state = makeState();
    const next = applyCommand(state, '/who');

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].text).toContain('Players here:');
    expect(next.messages[0].text).toContain('Hero');
  });
});
