import { OpenRouter } from '@openrouter/sdk';
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

export interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  siteUrl?: string;
  siteName?: string;
}

export function createOpenRouterAdapter(config: OpenRouterConfig): AIAdapter {
  const client = new OpenRouter({
    apiKey: config.apiKey,
  });

  // Default to a free model - can override via OPENROUTER_MODEL env var
  // Free models: meta-llama/llama-3.2-3b-instruct:free, nousresearch/hermes-3-llama-3.1-405b:free
  const model = config.model ?? 'nousresearch/hermes-3-llama-3.1-405b:free';

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

      const prompt = `You are a narrator for a roguelike game set in the following universe:

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

      const completion = await client.chat.send({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        stream: false,
        maxTokens: 1500,
      });

      const rawContent = completion.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new Error('No response from AI');
      }

      // Handle array content (multi-part responses)
      const content = typeof rawContent === 'string'
        ? rawContent
        : rawContent.map((part) => ('text' in part ? part.text : '')).join('');

      // Parse and validate the response
      let parsed: unknown;
      try {
        // Strip any markdown code blocks if present
        let cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // Try to repair truncated JSON by adding missing closing braces
        if (!cleaned.endsWith('}')) {
          // Count opening vs closing braces
          const openBraces = (cleaned.match(/{/g) || []).length;
          const closeBraces = (cleaned.match(/}/g) || []).length;
          const missing = openBraces - closeBraces;
          if (missing > 0) {
            // Remove any trailing incomplete string/value
            cleaned = cleaned.replace(/,?\s*"[^"]*$/, '');
            cleaned = cleaned.replace(/,?\s*"[^"]*":\s*"[^"]*$/, '');
            cleaned += '}'.repeat(missing);
          }
        }

        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.error('Failed to parse AI response:', content, e);
        // Return a fallback response
        return createFallbackResponse(request);
      }

      // Transform arrays to objects if the AI returned array format
      const normalized = normalizeAiResponse(parsed);

      const result = RoomFlavorResponseSchema.safeParse(normalized);
      if (!result.success) {
        console.error('AI response validation failed:', result.error.format());
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

// Mock adapter for testing without API calls
export function createMockAdapter(): AIAdapter {
  return {
    async generateRoomFlavor(request: RoomFlavorRequest): Promise<RoomFlavorResponse> {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 100));
      return createFallbackResponse(request);
    },
  };
}
