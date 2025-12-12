import { OpenRouter } from '@openrouter/sdk';
import type { AIAdapter, RoomFlavorRequest, RoomFlavorResponse } from './contracts.js';
import type { TileFlavor, TileKind } from '../domain/model.js';
import { TILE_DESCRIPTIONS, TILE_DATA } from '../domain/tiles.js';
import { normalizeAiResponse, createFallbackResponse, RoomFlavorResponseSchema } from './utils.js';
import { consoleLogger, type Logger } from '../utils/logger.js';

export interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  siteUrl?: string;
  siteName?: string;
  logger?: Logger;
}

export function createOpenRouterAdapter(config: OpenRouterConfig): AIAdapter {
  const logger = config.logger ?? consoleLogger;
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
      const normalized = normalizeAiResponse(parsed, logger);

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
