/**
 * Shared utilities for AI adapters.
 * This module eliminates duplication between different AI provider implementations.
 */

import { z } from 'zod';
import type { RoomFlavorRequest, RoomFlavorResponse } from './contracts.js';
import type { EnemyFlavor, TileKind } from '../domain/model.js';
import { TILE_DATA } from '../domain/tiles.js';
import type { Logger } from '../utils/logger.js';
import { consoleLogger } from '../utils/logger.js';

// Zod schemas for validating AI responses
const EnemyFlavorSchema = z.object({
  name: z.string(),
  shortDescription: z.string(),
  longDescription: z.string().optional(),
});

const TileFlavorSchema = z.object({
  name: z.string(),
  char: z.string(),
  fg: z.string(),
  bg: z.string().optional(),
  description: z.string().optional(),
});

const RoomFlavorResponseSchema = z.object({
  roomDescription: z.string(),
  enemyFlavors: z.record(z.string(), EnemyFlavorSchema),
  tileFlavors: z.record(z.string(), TileFlavorSchema),
});

// Export schemas for use in adapters
export { RoomFlavorResponseSchema };

/**
 * Normalize AI response to handle common format issues:
 * - Convert arrays to objects (AI often returns arrays instead of keyed objects)
 * - Add default char/fg if missing from tileFlavors
 * @param parsed - The parsed AI response to normalize
 * @param logger - Optional logger for error reporting (defaults to console)
 */
export function normalizeAiResponse(parsed: unknown, logger: Logger = consoleLogger): unknown {
  if (typeof parsed !== 'object' || parsed === null) return parsed;

  const obj = parsed as Record<string, unknown>;
  const result: Record<string, unknown> = { ...obj };

  // Convert enemyFlavors array to object keyed by id
  if (Array.isArray(obj.enemyFlavors)) {
    const enemyMap: Record<string, unknown> = {};
    for (const item of obj.enemyFlavors) {
      if (typeof item === 'object' && item !== null && 'id' in item) {
        const { id, ...rest } = item as Record<string, unknown>;
        enemyMap[id as string] = rest;
      } else {
        logger.warn('Invalid enemy flavor item in array:', item);
      }
    }
    result.enemyFlavors = enemyMap;
  }

  // Convert tileFlavors array to object keyed by kind, and add defaults
  if (Array.isArray(obj.tileFlavors)) {
    const tileMap: Record<string, unknown> = {};
    for (const item of obj.tileFlavors) {
      if (typeof item === 'object' && item !== null && 'kind' in item) {
        const { kind, ...rest } = item as Record<string, unknown>;
        const kindStr = kind as string;

        // Add default char and fg if missing
        const tileData = TILE_DATA[kindStr as TileKind];
        const normalized = {
          char: tileData?.char ?? '?',
          fg: tileData?.fg ?? '#888888',
          ...rest,
        };
        tileMap[kindStr] = normalized;
      }
    }
    result.tileFlavors = tileMap;
  } else if (typeof obj.tileFlavors === 'object' && obj.tileFlavors !== null) {
    // It's already an object, but add defaults for any missing char/fg
    const tileMap: Record<string, unknown> = {};
    for (const [kind, value] of Object.entries(obj.tileFlavors as Record<string, unknown>)) {
      if (typeof value === 'object' && value !== null) {
        const tileData = TILE_DATA[kind as TileKind];
        const normalized = {
          char: tileData?.char ?? '?',
          fg: tileData?.fg ?? '#888888',
          ...(value as Record<string, unknown>),
        };
        tileMap[kind] = normalized;
      }
    }
    result.tileFlavors = tileMap;
  }

  return result;
}

/**
 * Create a fallback response when AI generation fails.
 * Provides reasonable defaults for enemy names and descriptions.
 */
export function createFallbackResponse(request: RoomFlavorRequest): RoomFlavorResponse {
  const enemyFlavors: Record<string, EnemyFlavor> = {};

  for (const template of request.enemyTemplates) {
    const roleNames: Record<string, string> = {
      Common: 'Lurker',
      Elite: 'Champion',
      Boss: 'Overlord',
    };

    enemyFlavors[template.id] = {
      name: `${roleNames[template.role] ?? 'Creature'} of the Depths`,
      shortDescription: `A ${template.role.toLowerCase()} enemy`,
    };
  }

  // Return empty tileFlavors - will fall back to defaults
  return {
    roomDescription: 'You enter a dimly lit area. The air is thick with tension.',
    enemyFlavors,
    tileFlavors: {},
  };
}