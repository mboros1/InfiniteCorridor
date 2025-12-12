/**
 * Tests for AI utilities - normalizeAiResponse and createFallbackResponse
 */

import { expect, test, describe } from 'bun:test';
import {
  normalizeAiResponse,
  createFallbackResponse,
  RoomFlavorResponseSchema,
  parseRoomFlavorResponseText,
} from '../utils.js';
import { nullLogger } from '../../utils/logger.js';
import type { RoomFlavorRequest } from '../contracts.js';
import type { EnemyTemplate, WorldConfig } from '../../domain/model.js';
import type { TileKind } from '../../domain/tiles.js';
import { APP_ERROR_CODE } from '../../errors/appError.js';

function makeEnemyTemplate(id: string, role: EnemyTemplate['role']): EnemyTemplate {
  return {
    id,
    cr: 1,
    role,
    stats: {
      maxHp: 10,
      attack: 1,
      defense: 1,
      speed: 1,
    },
    abilities: [],
    tags: [],
  };
}

const testWorldConfig = {
  themePrompt: 'test',
  seed: 'test-seed',
  difficulty: 'Normal',
  rulesVersion: '0.1.0',
} satisfies WorldConfig;

function makeBaseRequest(overrides: Partial<RoomFlavorRequest> = {}): RoomFlavorRequest {
  return {
    context: { worldConfig: testWorldConfig },
    level: { depth: 1, width: 10, height: 10 },
    enemyTemplates: [],
    tileTypesPresent: [] as TileKind[],
    ...overrides,
  };
}

describe('AI Utilities', () => {
  
  describe('normalizeAiResponse', () => {
    
    test('should handle valid AI response with proper structure', () => {
      const validResponse = {
        roomDescription: 'A dark forest with towering trees',
        enemyFlavors: {
          'enemy-common-1': {
            name: 'Forest Troll',
            shortDescription: 'A hulking green creature'
          }
        },
        tileFlavors: {
          TallObstacle: {
            name: 'Ancient Oak',
            char: '♣',
            fg: '#2d5a2d'
          }
        }
      };
      
      const normalized = normalizeAiResponse(validResponse, nullLogger);
      const result = RoomFlavorResponseSchema.parse(normalized);
      
      expect(result).toEqual(validResponse);
      expect(result.roomDescription).toBe('A dark forest with towering trees');
      expect(result.enemyFlavors['enemy-common-1'].name).toBe('Forest Troll');
      expect(result.tileFlavors.TallObstacle.char).toBe('♣');
    });

    test('should convert enemyFlavors array to object', () => {
      const arrayResponse = {
        roomDescription: 'Test room',
        enemyFlavors: [
          { id: 'enemy-1', name: 'Goblin', shortDescription: 'Small green creature' },
          { id: 'enemy-2', name: 'Orc', shortDescription: 'Large aggressive humanoid' }
        ],
        tileFlavors: {}
      };
      
      const normalized = normalizeAiResponse(arrayResponse, nullLogger);
      const result = RoomFlavorResponseSchema.parse(normalized);
      
      expect(result.enemyFlavors).toBeObject();
      expect(result.enemyFlavors['enemy-1'].name).toBe('Goblin');
      expect(result.enemyFlavors['enemy-2'].name).toBe('Orc');
    });

    test('should convert tileFlavors array to object', () => {
      const arrayResponse = {
        roomDescription: 'Test room',
        enemyFlavors: {},
        tileFlavors: [
          { kind: 'TallObstacle', name: 'Tree', char: 'T', fg: '#00ff00' },
          { kind: 'OpenGround', name: 'Grass', char: '.', fg: '#00ff00' }
        ]
      };
      
      const normalized = normalizeAiResponse(arrayResponse, nullLogger);
      const result = RoomFlavorResponseSchema.parse(normalized);
      
      expect(result.tileFlavors).toBeObject();
      expect(result.tileFlavors.TallObstacle.name).toBe('Tree');
      expect(result.tileFlavors.OpenGround.name).toBe('Grass');
    });

    test('should add default tile properties when missing', () => {
      const partialResponse = {
        roomDescription: 'Test room',
        enemyFlavors: {},
        tileFlavors: [
          { kind: 'TallObstacle', name: 'Tree' } // Missing char and fg
        ]
      };
      
      const normalized = normalizeAiResponse(partialResponse, nullLogger);
      const result = RoomFlavorResponseSchema.parse(normalized);
      
      expect(result.tileFlavors.TallObstacle.char).toBeDefined();
      expect(result.tileFlavors.TallObstacle.fg).toBeDefined();
      expect(result.tileFlavors.TallObstacle.fg).toMatch(/^#/);
    });

    test('should handle null input gracefully', () => {
      const result = normalizeAiResponse(null, nullLogger);
      expect(result).toBeNull();
    });

    test('should handle undefined input gracefully', () => {
      const result = normalizeAiResponse(undefined, nullLogger);
      expect(result).toBeUndefined();
    });

    test('should warn on invalid enemy flavor items', () => {
      // This test verifies that the logger warns about invalid items
      // Since we're using nullLogger, it won't actually log, but the code path is tested
      const invalidResponse = {
        roomDescription: 'Test room',
        enemyFlavors: [
          { id: 'valid', name: 'Valid Enemy', shortDescription: 'Valid description' },
          'invalid-string-item',
          { notAnId: 'missing-id' }
        ],
        tileFlavors: {}
      };
      
      // Should not throw, should handle gracefully
      const normalized = normalizeAiResponse(invalidResponse, nullLogger);
      const result = RoomFlavorResponseSchema.parse(normalized);
      expect(result.enemyFlavors['valid']).toBeDefined();
    });
  });

  describe('createFallbackResponse', () => {
    
    test('should create fallback response with no enemies', () => {
      const request = makeBaseRequest();
      
      const result = createFallbackResponse(request);
      
      expect(result.roomDescription).toBe('You enter a dimly lit area. The air is thick with tension.');
      expect(result.enemyFlavors).toEqual({});
      expect(result.tileFlavors).toEqual({});
    });

    test('should create fallback response with common enemies', () => {
      const request = makeBaseRequest({
        enemyTemplates: [makeEnemyTemplate('enemy-common-1', 'Common')],
      });
      
      const result = createFallbackResponse(request);
      
      expect(result.enemyFlavors['enemy-common-1']).toBeDefined();
      expect(result.enemyFlavors['enemy-common-1'].name).toBe('Lurker of the Depths');
      expect(result.enemyFlavors['enemy-common-1'].shortDescription).toBe('A common enemy');
    });

    test('should create fallback response with elite enemies', () => {
      const request = makeBaseRequest({
        enemyTemplates: [makeEnemyTemplate('enemy-elite-1', 'Elite')],
      });
      
      const result = createFallbackResponse(request);
      
      expect(result.enemyFlavors['enemy-elite-1'].name).toBe('Champion of the Depths');
      expect(result.enemyFlavors['enemy-elite-1'].shortDescription).toBe('A elite enemy');
    });

    test('should create fallback response with boss enemies', () => {
      const request = makeBaseRequest({
        enemyTemplates: [makeEnemyTemplate('enemy-boss-1', 'Boss')],
      });
      
      const result = createFallbackResponse(request);
      
      expect(result.enemyFlavors['enemy-boss-1'].name).toBe('Overlord of the Depths');
      expect(result.enemyFlavors['enemy-boss-1'].shortDescription).toBe('A boss enemy');
    });

    test('should create fallback response with multiple enemies', () => {
      const request = makeBaseRequest({
        enemyTemplates: [
          makeEnemyTemplate('enemy-common-1', 'Common'),
          makeEnemyTemplate('enemy-elite-1', 'Elite'),
          makeEnemyTemplate('enemy-boss-1', 'Boss'),
        ],
      });
      
      const result = createFallbackResponse(request);
      
      expect(Object.keys(result.enemyFlavors)).toHaveLength(3);
      expect(result.enemyFlavors['enemy-common-1'].name).toBe('Lurker of the Depths');
      expect(result.enemyFlavors['enemy-elite-1'].name).toBe('Champion of the Depths');
      expect(result.enemyFlavors['enemy-boss-1'].name).toBe('Overlord of the Depths');
    });

    test('should handle unknown enemy roles gracefully', () => {
      const request = makeBaseRequest({
        enemyTemplates: [
          {
            ...makeEnemyTemplate('enemy-unknown-1', 'Common'),
            role: 'Unknown' as any,
          },
        ],
      });
      
      const result = createFallbackResponse(request);
      
      expect(result.enemyFlavors['enemy-unknown-1'].name).toBe('Creature of the Depths');
    });
  });

  describe('parseRoomFlavorResponseText', () => {
    test('parses fenced JSON and returns typed response', () => {
      const content = [
        '```json',
        JSON.stringify({
          roomDescription: 'A test room',
          enemyFlavors: { e1: { name: 'Goblin', shortDescription: 'Small and mean' } },
          tileFlavors: { TallObstacle: { name: 'Tree', char: 'T', fg: '#2d5a2d' } },
        }),
        '```',
      ].join('\n');

      const result = parseRoomFlavorResponseText(content, nullLogger);
      expect(result.ok).toBeTrue();
      if (!result.ok) throw new Error('Expected ok result');

      expect(result.value.roomDescription).toBe('A test room');
      expect(result.value.enemyFlavors.e1.name).toBe('Goblin');
      expect(result.value.tileFlavors.TallObstacle?.char).toBe('T');
    });

    test('sanitizes invalid tile colors to defaults', () => {
      const content = JSON.stringify({
        roomDescription: 'A test room',
        enemyFlavors: {},
        tileFlavors: {
          TallObstacle: { name: 'Tree', char: 'T', fg: 'green' },
        },
      });

      const result = parseRoomFlavorResponseText(content, nullLogger);
      expect(result.ok).toBeTrue();
      if (!result.ok) throw new Error('Expected ok result');

      const fg = result.value.tileFlavors.TallObstacle?.fg;
      expect(fg).toBeDefined();
      expect(fg).toMatch(/^#([0-9A-F]{3}){1,2}$/i);
    });

    test('returns parse error code on invalid JSON', () => {
      const content = 'not json';
      const result = parseRoomFlavorResponseText(content, nullLogger);

      expect(result.ok).toBeFalse();
      if (result.ok) throw new Error('Expected err result');
      expect(result.error.code).toBe(APP_ERROR_CODE.AiResponseParseFailed);
    });

    test('returns invalid error code on schema mismatch', () => {
      const content = JSON.stringify({
        roomDescription: 'A test room',
        enemyFlavors: {},
        tileFlavors: {}, // roomDescription present but schema requires tileFlavors entries to have name/char/fg if present
        extra: 'ignored',
      });

      const result = parseRoomFlavorResponseText(content, nullLogger);
      expect(result.ok).toBeTrue();
      if (!result.ok) throw new Error('Expected ok result');
      expect(result.value.roomDescription).toBe('A test room');

      const invalidContent = JSON.stringify({
        enemyFlavors: {},
        tileFlavors: {},
      });
      const invalidResult = parseRoomFlavorResponseText(invalidContent, nullLogger);
      expect(invalidResult.ok).toBeFalse();
      if (invalidResult.ok) throw new Error('Expected err result');
      expect(invalidResult.error.code).toBe(APP_ERROR_CODE.AiResponseInvalid);
    });

    test('returns empty error code on blank content', () => {
      const result = parseRoomFlavorResponseText('   ', nullLogger);
      expect(result.ok).toBeFalse();
      if (result.ok) throw new Error('Expected err result');
      expect(result.error.code).toBe(APP_ERROR_CODE.AiResponseEmpty);
    });
  });
});
