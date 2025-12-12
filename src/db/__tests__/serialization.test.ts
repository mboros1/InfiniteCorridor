/**
 * Tests for serialization functions
 */

import { expect, test, describe } from 'bun:test';
import {
  serializeLevel,
  deserializeLevel,
  serializeTileFlavors,
  deserializeTileFlavors,
  serializeEnemyFlavors,
  deserializeEnemyFlavors,
  serializeGameState,
  deserializeGameState
} from '../serialization.js';

describe('Serialization Functions', () => {
  
  describe('Level Serialization', () => {
    
    test('should serialize and deserialize level correctly', () => {
      const level = {
        id: 'test-level',
        depth: 1,
        width: 10,
        height: 10,
        tiles: Array(100).fill('OpenGround'),
        discovered: Array(100).fill(false),
        entities: [
          {
            id: 'player-1',
            kind: 'Player',
            name: 'Test Player',
            position: { x: 5, y: 5 },
            hp: 20,
            maxHp: 20,
            strength: 10,
            agility: 10,
            intellect: 10
          }
        ]
      };
      
      const serialized = serializeLevel(level);
      expect(typeof serialized).toBe('string');
      
      const deserialized = deserializeLevel(serialized);
      expect(deserialized).toEqual(level);
      expect(deserialized.id).toBe('test-level');
      expect(deserialized.entities[0].name).toBe('Test Player');
    });

    test('should validate level before serialization', () => {
      const invalidLevel = {
        id: 'test-level',
        depth: 1,
        width: 10,
        height: 10,
        tiles: Array(100).fill('InvalidTileType'), // Invalid tile type
        discovered: Array(100).fill(false),
        entities: []
      };
      
      // Should throw validation error
      expect(() => serializeLevel(invalidLevel)).toThrow();
    });

    test('should handle empty level', () => {
      const level = {
        id: 'empty-level',
        depth: 1,
        width: 5,
        height: 5,
        tiles: Array(25).fill('OpenGround'),
        discovered: Array(25).fill(false),
        entities: []
      };
      
      const serialized = serializeLevel(level);
      const deserialized = deserializeLevel(serialized);
      
      expect(deserialized).toEqual(level);
      expect(deserialized.entities).toHaveLength(0);
    });
  });

  describe('Tile Flavors Serialization', () => {
    
    test('should serialize and deserialize tile flavors', () => {
      const tileFlavors = {
        TallObstacle: {
          name: 'Ancient Tree',
          char: '♣',
          fg: '#2d5a2d',
          description: 'A majestic old tree'
        },
        OpenGround: {
          name: 'Grass',
          char: '.',
          fg: '#4a7c4a'
        }
      };
      
      const serialized = serializeTileFlavors(tileFlavors);
      expect(typeof serialized).toBe('string');
      
      const deserialized = deserializeTileFlavors(serialized);
      expect(deserialized).toEqual(tileFlavors);
      expect(deserialized?.TallObstacle.name).toBe('Ancient Tree');
    });

    test('should handle empty tile flavors', () => {
      const serialized = serializeTileFlavors({});
      expect(serialized).toBe('{}');
      
      const deserialized = deserializeTileFlavors(serialized);
      expect(deserialized).toEqual({});
    });

    test('should handle null/undefined tile flavors', () => {
      expect(serializeTileFlavors(null)).toBeNull();
      expect(serializeTileFlavors(undefined)).toBeNull();
      expect(deserializeTileFlavors(null)).toBeUndefined();
      expect(deserializeTileFlavors(undefined)).toBeUndefined();
    });

    test('should validate tile flavors before serialization', () => {
      const invalidTileFlavors = {
        TallObstacle: {
          name: 'Tree',
          char: 'T',
          fg: 'invalid-color' // Invalid hex color
        }
      };
      
      // Should throw validation error
      expect(() => serializeTileFlavors(invalidTileFlavors)).toThrow();
    });
  });

  describe('Enemy Flavors Serialization', () => {
    
    test('should serialize and deserialize enemy flavors', () => {
      const enemyFlavors = {
        'enemy-common-1': {
          name: 'Forest Troll',
          shortDescription: 'A hulking green creature',
          longDescription: 'A troll that lives in the forest'
        },
        'enemy-elite-1': {
          name: 'Troll Champion',
          shortDescription: 'A powerful troll warrior'
        }
      };
      
      const serialized = serializeEnemyFlavors(enemyFlavors);
      expect(typeof serialized).toBe('string');
      
      const deserialized = deserializeEnemyFlavors(serialized);
      expect(deserialized).toEqual(enemyFlavors);
      expect(deserialized?.['enemy-common-1'].name).toBe('Forest Troll');
    });

    test('should handle empty enemy flavors', () => {
      const serialized = serializeEnemyFlavors({});
      expect(serialized).toBe('{}');
      
      const deserialized = deserializeEnemyFlavors(serialized);
      expect(deserialized).toEqual({});
    });

    test('should handle null/undefined enemy flavors', () => {
      expect(serializeEnemyFlavors(null)).toBeNull();
      expect(serializeEnemyFlavors(undefined)).toBeNull();
      expect(deserializeEnemyFlavors(null)).toBeUndefined();
      expect(deserializeEnemyFlavors(undefined)).toBeUndefined();
    });

    test('should validate enemy flavors before serialization', () => {
      const invalidEnemyFlavors = {
        'enemy-common-1': {
          name: '', // Empty name - should fail validation
          shortDescription: 'test'
        }
      };
      
      // Should throw validation error
      expect(() => serializeEnemyFlavors(invalidEnemyFlavors)).toThrow();
    });
  });

  describe('Game State Serialization', () => {
    
    test('should serialize and deserialize game state', () => {
      const gameState = {
        worldConfig: {
          themePrompt: 'A fantasy forest',
          seed: 'test-seed',
          difficulty: 'Normal',
          rulesVersion: '0.1.0'
        },
        seed: 42,
        world: {
          levels: {},
          edges: [],
          currentLevelId: 'test-level'
        },
        currentLevel: {
          id: 'test-level',
          depth: 1,
          width: 10,
          height: 10,
          tiles: Array(100).fill('OpenGround'),
          discovered: Array(100).fill(false),
          entities: []
        },
        playerId: 'player-1',
        turn: 0,
        messages: [],
        enemyFlavors: {},
        tileFlavors: {},
        roomDescription: 'A test room'
      };
      
      const serialized = serializeGameState(gameState);
      expect(typeof serialized).toBe('string');
      
      const deserialized = deserializeGameState(serialized);
      expect(deserialized).toEqual(gameState);
      expect(deserialized.worldConfig.themePrompt).toBe('A fantasy forest');
      expect(deserialized.roomDescription).toBe('A test room');
    });

    test('should validate game state before serialization', () => {
      const invalidGameState = {
        worldConfig: {
          themePrompt: '', // Empty theme prompt - should fail validation
          seed: 'test-seed',
          difficulty: 'Normal',
          rulesVersion: '0.1.0'
        },
        seed: 42,
        world: {
          levels: {},
          edges: [],
          currentLevelId: 'test-level'
        },
        currentLevel: {
          id: 'test-level',
          depth: 1,
          width: 10,
          height: 10,
          tiles: Array(100).fill('OpenGround'),
          discovered: Array(100).fill(false),
          entities: []
        },
        playerId: 'player-1',
        turn: 0,
        messages: [],
        enemyFlavors: {},
        tileFlavors: {}
      };
      
      // Should throw validation error
      expect(() => serializeGameState(invalidGameState)).toThrow();
    });

    test('should handle complex game state with entities', () => {
      const gameState = {
        worldConfig: {
          themePrompt: 'Test World',
          seed: 'test-seed',
          difficulty: 'Normal',
          rulesVersion: '0.1.0'
        },
        seed: 42,
        world: {
          levels: {},
          edges: [],
          currentLevelId: 'test-level'
        },
        currentLevel: {
          id: 'test-level',
          depth: 1,
          width: 10,
          height: 10,
          tiles: Array(100).fill('OpenGround'),
          discovered: Array(100).fill(false),
          entities: [
            {
              id: 'player-1',
              kind: 'Player',
              name: 'Hero',
              position: { x: 5, y: 5 },
              hp: 20,
              maxHp: 20,
              strength: 10,
              agility: 10,
              intellect: 10
            },
            {
              id: 'enemy-1',
              kind: 'Monster',
              templateId: 'enemy-common-1',
              position: { x: 3, y: 3 },
              hp: 10,
              maxHp: 10
            }
          ]
        },
        playerId: 'player-1',
        turn: 5,
        messages: [
          {
            turn: 1,
            text: 'Game started',
            kind: 'system'
          }
        ],
        enemyFlavors: {
          'enemy-common-1': {
            name: 'Goblin',
            shortDescription: 'Small green creature'
          }
        },
        tileFlavors: {
          TallObstacle: {
            name: 'Tree',
            char: 'T',
            fg: '#2d5a2d'
          }
        },
        roomDescription: 'A test room with enemies'
      };
      
      const serialized = serializeGameState(gameState);
      const deserialized = deserializeGameState(serialized);
      
      expect(deserialized).toEqual(gameState);
      expect(deserialized.currentLevel.entities).toHaveLength(2);
      expect(deserialized.messages).toHaveLength(1);
      expect(deserialized.enemyFlavors['enemy-common-1'].name).toBe('Goblin');
    });
  });

  describe('Round-trip Serialization', () => {
    
    test('should handle round-trip serialization correctly', () => {
      const originalLevel = {
        id: 'roundtrip-test',
        depth: 2,
        width: 5,
        height: 5,
        tiles: Array(25).fill('OpenGround'),
        discovered: Array(25).fill(false),
        entities: [
          {
            id: 'player-1',
            kind: 'Player',
            name: 'Roundtrip Player',
            position: { x: 2, y: 2 },
            hp: 15,
            maxHp: 20,
            strength: 12,
            agility: 8,
            intellect: 10
          }
        ]
      };
      
      const serialized = serializeLevel(originalLevel);
      const deserialized = deserializeLevel(serialized);
      const reserialized = serializeLevel(deserialized);
      const finalDeserialized = deserializeLevel(reserialized);
      
      expect(finalDeserialized).toEqual(originalLevel);
      expect(finalDeserialized.entities[0].name).toBe('Roundtrip Player');
    });
  });
});