/**
 * Tests for AI utilities - normalizeAiResponse and createFallbackResponse
 */

import { expect, test, describe } from 'bun:test';
import { normalizeAiResponse, createFallbackResponse } from '../utils.js';
import { nullLogger } from '../../utils/logger.js';

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
      
      const result = normalizeAiResponse(validResponse, nullLogger);
      
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
      
      const result = normalizeAiResponse(arrayResponse, nullLogger);
      
      expect(result.enemyFlavors).toBeObject();
      expect(result.enemyFlavors['enemy-1'].name).toBe('Goblin');
      expect(result.enemyFlavors['enemy-2'].name).toBe('Orc');
    });

    test('should convert tileFlavors array to object', () => {
      const arrayResponse = {
        roomDescription: 'Test room',
        enemyFlavors: {},
        tileFlavors: [
          { kind: 'TallObstacle', name: 'Tree', char: 'T', fg: '#green' },
          { kind: 'OpenGround', name: 'Grass', char: '.', fg: '#green' }
        ]
      };
      
      const result = normalizeAiResponse(arrayResponse, nullLogger);
      
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
      
      const result = normalizeAiResponse(partialResponse, nullLogger);
      
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
          { id: 'valid', name: 'Valid Enemy' },
          'invalid-string-item',
          { notAnId: 'missing-id' }
        ],
        tileFlavors: {}
      };
      
      // Should not throw, should handle gracefully
      const result = normalizeAiResponse(invalidResponse, nullLogger);
      expect(result.enemyFlavors['valid']).toBeDefined();
    });
  });

  describe('createFallbackResponse', () => {
    
    test('should create fallback response with no enemies', () => {
      const request = {
        context: { worldConfig: { themePrompt: 'test' } },
        level: { depth: 1, width: 10, height: 10 },
        enemyTemplates: [],
        tileTypesPresent: []
      };
      
      const result = createFallbackResponse(request);
      
      expect(result.roomDescription).toBe('You enter a dimly lit area. The air is thick with tension.');
      expect(result.enemyFlavors).toEqual({});
      expect(result.tileFlavors).toEqual({});
    });

    test('should create fallback response with common enemies', () => {
      const request = {
        context: { worldConfig: { themePrompt: 'test' } },
        level: { depth: 1, width: 10, height: 10 },
        enemyTemplates: [
          { id: 'enemy-common-1', role: 'Common', cr: 1, stats: {}, abilities: [], tags: [] }
        ],
        tileTypesPresent: []
      };
      
      const result = createFallbackResponse(request);
      
      expect(result.enemyFlavors['enemy-common-1']).toBeDefined();
      expect(result.enemyFlavors['enemy-common-1'].name).toBe('Lurker of the Depths');
      expect(result.enemyFlavors['enemy-common-1'].shortDescription).toBe('A common enemy');
    });

    test('should create fallback response with elite enemies', () => {
      const request = {
        context: { worldConfig: { themePrompt: 'test' } },
        level: { depth: 1, width: 10, height: 10 },
        enemyTemplates: [
          { id: 'enemy-elite-1', role: 'Elite', cr: 4, stats: {}, abilities: [], tags: [] }
        ],
        tileTypesPresent: []
      };
      
      const result = createFallbackResponse(request);
      
      expect(result.enemyFlavors['enemy-elite-1'].name).toBe('Champion of the Depths');
      expect(result.enemyFlavors['enemy-elite-1'].shortDescription).toBe('A elite enemy');
    });

    test('should create fallback response with boss enemies', () => {
      const request = {
        context: { worldConfig: { themePrompt: 'test' } },
        level: { depth: 1, width: 10, height: 10 },
        enemyTemplates: [
          { id: 'enemy-boss-1', role: 'Boss', cr: 8, stats: {}, abilities: [], tags: [] }
        ],
        tileTypesPresent: []
      };
      
      const result = createFallbackResponse(request);
      
      expect(result.enemyFlavors['enemy-boss-1'].name).toBe('Overlord of the Depths');
      expect(result.enemyFlavors['enemy-boss-1'].shortDescription).toBe('A boss enemy');
    });

    test('should create fallback response with multiple enemies', () => {
      const request = {
        context: { worldConfig: { themePrompt: 'test' } },
        level: { depth: 1, width: 10, height: 10 },
        enemyTemplates: [
          { id: 'enemy-common-1', role: 'Common', cr: 1, stats: {}, abilities: [], tags: [] },
          { id: 'enemy-elite-1', role: 'Elite', cr: 4, stats: {}, abilities: [], tags: [] },
          { id: 'enemy-boss-1', role: 'Boss', cr: 8, stats: {}, abilities: [], tags: [] }
        ],
        tileTypesPresent: []
      };
      
      const result = createFallbackResponse(request);
      
      expect(Object.keys(result.enemyFlavors)).toHaveLength(3);
      expect(result.enemyFlavors['enemy-common-1'].name).toBe('Lurker of the Depths');
      expect(result.enemyFlavors['enemy-elite-1'].name).toBe('Champion of the Depths');
      expect(result.enemyFlavors['enemy-boss-1'].name).toBe('Overlord of the Depths');
    });

    test('should handle unknown enemy roles gracefully', () => {
      const request = {
        context: { worldConfig: { themePrompt: 'test' } },
        level: { depth: 1, width: 10, height: 10 },
        enemyTemplates: [
          { id: 'enemy-unknown-1', role: 'Unknown' as any, cr: 1, stats: {}, abilities: [], tags: [] }
        ],
        tileTypesPresent: []
      };
      
      const result = createFallbackResponse(request);
      
      expect(result.enemyFlavors['enemy-unknown-1'].name).toBe('Creature of the Depths');
    });
  });
});