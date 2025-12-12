/**
 * Anthropic Claude API adapter for AI flavor generation.
 *
 * Uses the official @anthropic-ai/sdk package.
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AIAdapter, RoomFlavorRequest, RoomFlavorResponse } from './contracts.js';
import type { EnemyFlavor, TileFlavor, TileKind } from '../domain/model.js';
import { TILE_DESCRIPTIONS, TILE_DATA } from '../domain/tiles.js';

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

/**
 * Normalize AI response to handle common format issues:
 * - Convert arrays to objects (AI often returns arrays instead of keyed objects)
 * - Add default char/fg if missing from tileFlavors
 */
function normalizeAiResponse(parsed: unknown): unknown {
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

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
}

export function createAnthropicAdapter(config: AnthropicConfig): AIAdapter {
  const client = new Anthropic({
    apiKey: config.apiKey,
  });

  // Default to Haiku for speed and cost efficiency
  // Options: claude-3-5-haiku-20241022, claude-sonnet-4-20250514, claude-opus-4-20250514
  const model = config.model ?? 'claude-haiku-4-5-20251001';


  return {
    async generateRoomFlavor(request: RoomFlavorRequest): Promise<RoomFlavorResponse> {
      const { context, level, enemyTemplates, tileTypesPresent } = request;

      // Build enemy descriptions
      const enemyDescriptions = enemyTemplates.map((t) => {
        const abilities = t.abilities.map((a) => a.kind).join(', ');
        return `- Template "${t.id}": CR ${t.cr}, Role: ${t.role}, Tags: [${t.tags.join(', ')}], Abilities: [${abilities}]`;
      }).join('\n');

      // Build tile type descriptions
      const tileDescriptions = tileTypesPresent.map((kind) => {
        const desc = TILE_DESCRIPTIONS[kind];
        const defaultChar = TILE_DATA[kind].char;
        return `- "${kind}": ${desc} (default char: "${defaultChar}")`;
      }).join('\n');

      const userPrompt = `You are a narrator for a roguelike game set in the following universe:

"${context.worldConfig.themePrompt}"

The player has entered a new area on depth ${level.depth}.
Area dimensions: ${level.width}x${level.height}

${enemyTemplates.length > 0 ? `Enemies present (mechanical templates - you provide the flavor):
${enemyDescriptions}` : 'The area appears empty of enemies.'}

Abstract tile types present (you provide themed interpretations):
${tileDescriptions}

${context.recentNarrativeSummary ? `Recent events: ${context.recentNarrativeSummary}` : ''}

Generate a JSON response with this exact structure:
{
  "roomDescription": "1-2 sentence atmospheric description",
  "enemyFlavors": {
    "enemy-template-id": {
      "name": "Thematic Name",
      "shortDescription": "Brief description under 10 words"
    }
  },
  "tileFlavors": {
    "TileKindName": {
      "name": "Themed name",
      "char": "T",
      "fg": "#hexcolor"
    }
  }
}

IMPORTANT for tileFlavors:
- Keys must be the exact tile kind names (e.g., "TallObstacle", "OpenGround")
- "char": REQUIRED - single character (ASCII/Unicode) to display
- "fg": REQUIRED - hex color like "#2d5a2d"
- "bg": optional hex background color
- "name": what this tile represents in your theme

Theme interpretation examples:
- Forest: TallObstacle="♣" (tree), OpenGround="." (grass)
- Space station: TallObstacle="┃" (pillar), OpenGround="░" (grating)
- Candy land: TallObstacle="♠" (lollipop), Transition="◊" (candy portal)

Respond with ONLY valid JSON, no markdown.`;

      const message = await client.messages.create({
        model,
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      // Extract text content from response
      const textBlock = message.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const content = textBlock.text;

      // Parse and validate the response
      let parsed: unknown;
      try {
        // Strip any markdown code blocks if present
        let cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // Try to repair truncated JSON by adding missing closing braces
        if (!cleaned.endsWith('}')) {
          const openBraces = (cleaned.match(/{/g) || []).length;
          const closeBraces = (cleaned.match(/}/g) || []).length;
          const missing = openBraces - closeBraces;
          if (missing > 0) {
            cleaned = cleaned.replace(/,?\s*"[^"]*$/, '');
            cleaned = cleaned.replace(/,?\s*"[^"]*":\s*"[^"]*$/, '');
            cleaned += '}'.repeat(missing);
          }
        }

        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.error('Failed to parse Claude response:', content, e);
        return createFallbackResponse(request);
      }

      // Transform arrays to objects if the AI returned array format
      const normalized = normalizeAiResponse(parsed);

      const result = RoomFlavorResponseSchema.safeParse(normalized);
      if (!result.success) {
        console.error('Claude response validation failed:', result.error.format());
        return createFallbackResponse(request);
      }

      // Convert tileFlavors keys to proper TileKind type
      const typedTileFlavors: Partial<Record<TileKind, TileFlavor>> = {};
      for (const [key, value] of Object.entries(result.data.tileFlavors)) {
        if (key in TILE_DATA) {
          typedTileFlavors[key as TileKind] = value;
        }
      }

      return {
        roomDescription: result.data.roomDescription,
        enemyFlavors: result.data.enemyFlavors,
        tileFlavors: typedTileFlavors,
      };
    },
  };
}

function createFallbackResponse(request: RoomFlavorRequest): RoomFlavorResponse {
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

// Re-export mock adapter for testing
export { createMockAdapter } from './openRouterAdapter.js';
