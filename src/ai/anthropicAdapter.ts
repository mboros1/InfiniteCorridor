/**
 * Anthropic Claude API adapter for AI flavor generation.
 *
 * Uses the official @anthropic-ai/sdk package.
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AIAdapter, RoomFlavorRequest, RoomFlavorResponse } from './contracts.js';
import type { TileFlavor, TileKind } from '../domain/model.js';
import { TILE_DESCRIPTIONS, TILE_DATA } from '../domain/tiles.js';
import { normalizeAiResponse, createFallbackResponse, RoomFlavorResponseSchema } from './utils.js';
import { consoleLogger, type Logger } from '../utils/logger.js';

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  logger?: Logger;
}

export function createAnthropicAdapter(config: AnthropicConfig): AIAdapter {
  const logger = config.logger ?? consoleLogger;
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
      const normalized = normalizeAiResponse(parsed, logger);

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

// Re-export mock adapter for testing
export { createMockAdapter } from './openRouterAdapter.js';
