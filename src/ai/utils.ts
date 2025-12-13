/**
 * Shared utilities for AI adapters.
 * This module eliminates duplication between different AI provider implementations.
 */

import { z } from 'zod';
import stringWidth from 'string-width';
import type { RoomFlavorRequest, RoomFlavorResponse } from './contracts.js';
import type { EnemyFlavor, TileFlavor, TileKind } from '../domain/model.js';
import { TILE_DATA, TILE_DESCRIPTIONS } from '../domain/tiles.js';
import type { Logger } from '../utils/logger.js';
import { consoleLogger } from '../utils/logger.js';
import { APP_ERROR_CODE, appError, type AppError } from '../errors/appError.js';
import { E } from '../utils/fp.js';

const HEX_COLOR_REGEX = /^#([0-9A-F]{3}){1,2}$/i;
const LINE_BREAK_REGEX = /[\n\r\u2028\u2029]/;
const UNICODE_OTHER_REGEX = /\p{C}/u;

export type RoomFlavorValidationIssue = {
  path: string;
  message: string;
};

function formatZodIssues(error: z.ZodError): RoomFlavorValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function graphemeCount(value: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let count = 0;
    for (const _ of segmenter.segment(value)) count++;
    return count;
  }

  return Array.from(value).length;
}

function isSingleLineSafeText(value: string): boolean {
  return !LINE_BREAK_REGEX.test(value) && !UNICODE_OTHER_REGEX.test(value);
}

function isDisplayChar(value: string): boolean {
  if (!value) return false;
  if (!isSingleLineSafeText(value)) return false;
  if (value.trim().length !== value.length) return false;
  if (graphemeCount(value) !== 1) return false;
  if (stringWidth(value) !== 1) return false;
  return true;
}

const SingleLineTextSchema = z
  .string()
  .min(1)
  .refine(isSingleLineSafeText, {
    message: 'Must be single-line and must not include control/format characters',
  });

const DisplayCharSchema = z.string().refine(isDisplayChar, {
  message: 'Must be a single, non-whitespace, single-column display character (no emoji)',
});

// Zod schemas for validating AI responses
const EnemyFlavorSchema = z.object({
  name: SingleLineTextSchema,
  shortDescription: SingleLineTextSchema,
  longDescription: SingleLineTextSchema.optional(),
});

const TileFlavorSchema = z.object({
  name: SingleLineTextSchema,
  char: DisplayCharSchema,
  fg: z.string().regex(HEX_COLOR_REGEX),
  bg: z.string().regex(HEX_COLOR_REGEX).optional(),
  description: SingleLineTextSchema.optional(),
});

const RoomFlavorResponseSchema = z.object({
  roomDescription: SingleLineTextSchema,
  enemyFlavors: z.record(z.string(), EnemyFlavorSchema),
  tileFlavors: z.record(z.string(), TileFlavorSchema),
});

// Export schemas for use in adapters
export { RoomFlavorResponseSchema };

export function buildRoomFlavorPrompt(request: RoomFlavorRequest): string {
  const { context, level, enemyTemplates, tileTypesPresent } = request;

  const enemyDescriptions = enemyTemplates
    .map((t) => {
      const abilities = t.abilities.map((a) => a.kind).join(', ');
      return `- Template "${t.id}": CR ${t.cr}, Role: ${t.role}, Tags: [${t.tags.join(', ')}], Abilities: [${abilities}]`;
    })
    .join('\n');

  const tileDescriptions = tileTypesPresent
    .map((kind) => {
      const desc = TILE_DESCRIPTIONS[kind];
      const defaultChar = TILE_DATA[kind].char;
      return `- "${kind}": ${desc} (default char: "${defaultChar}")`;
    })
    .join('\n');

  const recentEvents = context.recentNarrativeSummary
    ? `\n\nRecent events: ${context.recentNarrativeSummary}`
    : '';

  return `You are a narrator for a roguelike game set in the following universe:

"${context.worldConfig.themePrompt}"

The player has entered a new area on depth ${level.depth}.
Area dimensions: ${level.width}x${level.height}

${enemyTemplates.length > 0 ? `Enemies present (mechanical templates - you provide the flavor):
${enemyDescriptions}` : 'The area appears empty of enemies.'}

Abstract tile types present (you provide themed interpretations):
${tileDescriptions}${recentEvents}

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
}

function contentPreview(content: string, maxLen = 200): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + '...';
}

function cleanAiJsonText(content: string): string {
  let cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

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

  return cleaned;
}

export function parseRoomFlavorResponseText(
  content: string,
  logger: Logger = consoleLogger
): E.Either<AppError, RoomFlavorResponse> {
  if (!content.trim()) {
    return E.left(appError(APP_ERROR_CODE.AiResponseEmpty, 'AI response was empty'));
  }

  const cleaned = cleanAiJsonText(content);
  const parsed = E.tryCatch(
    () => JSON.parse(cleaned) as unknown,
    (cause) =>
      appError(APP_ERROR_CODE.AiResponseParseFailed, 'Failed to parse AI JSON response', {
        cause,
        context: {
          contentPreview: contentPreview(content),
        },
      })
  );
  if (E.isLeft(parsed)) return parsed;

  const normalized = normalizeAiResponse(parsed.right, logger);
  const result = RoomFlavorResponseSchema.safeParse(normalized);
  if (!result.success) {
    const validationIssues = formatZodIssues(result.error);
    return E.left(
      appError(APP_ERROR_CODE.AiResponseInvalid, 'AI response failed schema validation', {
        cause: result.error,
        context: {
          contentPreview: contentPreview(content),
          validationErrors: result.error.format(),
          validationIssues,
        },
      })
    );
  }

  const typedTileFlavors: Partial<Record<TileKind, TileFlavor>> = {};
  for (const [key, value] of Object.entries(result.data.tileFlavors)) {
    if (key in TILE_DATA) {
      typedTileFlavors[key as TileKind] = value;
    } else {
      logger.warn('Unknown tile kind from AI; ignoring', { kind: key });
    }
  }

  return E.right({
    roomDescription: result.data.roomDescription,
    enemyFlavors: result.data.enemyFlavors,
    tileFlavors: typedTileFlavors,
  });
}

function truncateForPrompt(text: string, maxLen = 8000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n...<truncated>';
}

export function shouldAttemptRoomFlavorRepair(error: AppError): boolean {
  return error.code === APP_ERROR_CODE.AiResponseParseFailed || error.code === APP_ERROR_CODE.AiResponseInvalid;
}

export function buildRoomFlavorRepairPrompt(params: { previousText: string; error: AppError }): string {
  const issuesRaw = params.error.context?.validationIssues;
  const issues = Array.isArray(issuesRaw) ? (issuesRaw as RoomFlavorValidationIssue[]) : [];

  const issueLines =
    issues.length > 0
      ? issues.map((issue) => `- ${issue.path || '(root)'}: ${issue.message}`).join('\n')
      : `- (root): ${params.error.message}`;

  const previousJsonText = truncateForPrompt(cleanAiJsonText(params.previousText));

  return `The JSON you returned failed validation. Fix it by changing as few fields as possible.
Return ONLY the corrected JSON object.

Hard constraints:
- All strings must be single-line (no \\n \\r U+2028 U+2029) and must not include Unicode \\p{C} characters.
- tileFlavors.*.char must be exactly 1 grapheme AND exactly 1 terminal column wide (no emoji). Use simple glyphs like ".", "#", "░", "█", "┃", "─", "◊", "♣".

Validation issues:
${issueLines}

Previous JSON:
${previousJsonText}
`;
}

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

        // Add default/validated char and colors if missing or invalid
        const tileData = TILE_DATA[kindStr as TileKind];
        const { char: charRaw, fg: fgRaw, bg: bgRaw, ...restWithoutColors } = rest as Record<string, unknown>;
        const normalizedChar =
          typeof charRaw === 'string' && charRaw.length > 0 ? charRaw : tileData?.char ?? '?';

        const normalizedFg =
          typeof fgRaw === 'string' && HEX_COLOR_REGEX.test(fgRaw) ? fgRaw : tileData?.fg ?? '#888888';
        if (typeof fgRaw === 'string' && !HEX_COLOR_REGEX.test(fgRaw)) {
          logger.warn('Invalid tile fg color from AI; using default', { kind: kindStr, fg: fgRaw });
        }

        let normalizedBg: string | undefined;
        if (typeof bgRaw === 'string') {
          if (HEX_COLOR_REGEX.test(bgRaw)) {
            normalizedBg = bgRaw;
          } else {
            logger.warn('Invalid tile bg color from AI; dropping', { kind: kindStr, bg: bgRaw });
          }
        }

        const normalized: Record<string, unknown> = {
          ...restWithoutColors,
          char: normalizedChar,
          fg: normalizedFg,
          ...(normalizedBg ? { bg: normalizedBg } : {}),
        };
        tileMap[kindStr] = normalized;
      } else {
        logger.warn('Invalid tile flavor item in array:', item);
      }
    }
    result.tileFlavors = tileMap;
  } else if (typeof obj.tileFlavors === 'object' && obj.tileFlavors !== null) {
    // It's already an object, but add defaults for any missing char/fg
    const tileMap: Record<string, unknown> = {};
    for (const [kind, value] of Object.entries(obj.tileFlavors as Record<string, unknown>)) {
      if (typeof value === 'object' && value !== null) {
        const tileData = TILE_DATA[kind as TileKind];
        const { char: charRaw, fg: fgRaw, bg: bgRaw, ...restWithoutColors } = value as Record<string, unknown>;
        const normalizedChar =
          typeof charRaw === 'string' && charRaw.length > 0 ? charRaw : tileData?.char ?? '?';

        const normalizedFg =
          typeof fgRaw === 'string' && HEX_COLOR_REGEX.test(fgRaw) ? fgRaw : tileData?.fg ?? '#888888';
        if (typeof fgRaw === 'string' && !HEX_COLOR_REGEX.test(fgRaw)) {
          logger.warn('Invalid tile fg color from AI; using default', { kind, fg: fgRaw });
        }

        let normalizedBg: string | undefined;
        if (typeof bgRaw === 'string') {
          if (HEX_COLOR_REGEX.test(bgRaw)) {
            normalizedBg = bgRaw;
          } else {
            logger.warn('Invalid tile bg color from AI; dropping', { kind, bg: bgRaw });
          }
        }

        const normalized: Record<string, unknown> = {
          ...restWithoutColors,
          char: normalizedChar,
          fg: normalizedFg,
          ...(normalizedBg ? { bg: normalizedBg } : {}),
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
