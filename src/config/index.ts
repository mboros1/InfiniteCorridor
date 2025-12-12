/**
 * Configuration loader for Infinite Corridor.
 *
 * Merges default config with environment variable overrides,
 * validates with Zod, and exports a frozen CONFIG object.
 */

import { GameConfigSchema, type GameConfig } from './schemas.js';
import { DEFAULT_CONFIG } from './defaults.js';

/**
 * Parse an integer from environment, returning undefined if not set or invalid.
 */
function parseEnvInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse a float from environment, returning undefined if not set or invalid.
 */
function parseEnvFloat(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse a boolean from environment, returning undefined if not set.
 */
function parseEnvBool(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Load configuration from defaults + environment variables.
 * Validates the result with Zod and throws on invalid config.
 */
function loadConfig(): GameConfig {
  const env = typeof process !== 'undefined' ? process.env : {};

  const rawConfig: GameConfig = {
    viewport: {
      minWidth: parseEnvInt(env.GAME_VIEWPORT_MIN_WIDTH) ?? DEFAULT_CONFIG.viewport.minWidth,
      minHeight: parseEnvInt(env.GAME_VIEWPORT_MIN_HEIGHT) ?? DEFAULT_CONFIG.viewport.minHeight,
      uiChromeHeight: parseEnvInt(env.GAME_UI_CHROME_HEIGHT) ?? DEFAULT_CONFIG.viewport.uiChromeHeight,
      sidebarWidth: parseEnvInt(env.GAME_SIDEBAR_WIDTH) ?? DEFAULT_CONFIG.viewport.sidebarWidth,
    },

    level: {
      width: parseEnvInt(env.GAME_LEVEL_WIDTH) ?? DEFAULT_CONFIG.level.width,
      height: parseEnvInt(env.GAME_LEVEL_HEIGHT) ?? DEFAULT_CONFIG.level.height,
    },

    gameplay: {
      playerFovRadius: parseEnvInt(env.GAME_FOV_RADIUS) ?? DEFAULT_CONFIG.gameplay.playerFovRadius,
      monsterDetectionRangeSq: parseEnvInt(env.GAME_MONSTER_RANGE_SQ) ?? DEFAULT_CONFIG.gameplay.monsterDetectionRangeSq,
    },

    biome: {
      treeDensity: parseEnvFloat(env.GAME_TREE_DENSITY) ?? DEFAULT_CONFIG.biome.treeDensity,
      waterChance: parseEnvFloat(env.GAME_WATER_CHANCE) ?? DEFAULT_CONFIG.biome.waterChance,
      clearingCount: parseEnvInt(env.GAME_CLEARING_COUNT) ?? DEFAULT_CONFIG.biome.clearingCount,
      pathWindiness: parseEnvFloat(env.GAME_PATH_WINDINESS) ?? DEFAULT_CONFIG.biome.pathWindiness,
      treeMinSpacing: parseEnvInt(env.GAME_TREE_MIN_SPACING) ?? DEFAULT_CONFIG.biome.treeMinSpacing,
    },

    server: {
      port: parseEnvInt(env.PORT) ?? DEFAULT_CONFIG.server.port,
      useAiAdapter: parseEnvBool(env.USE_AI_ADAPTER) ?? !!env.OPENROUTER_API_KEY,
    },

    client: {
      serverUrl: env.SERVER_URL ?? DEFAULT_CONFIG.client.serverUrl,
    },
  };

  // Validate with Zod
  const result = GameConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('Invalid game configuration:');
    console.error(result.error.format());
    throw new Error('Configuration validation failed');
  }

  // Freeze to prevent accidental mutation
  return Object.freeze(result.data);
}

/**
 * Global game configuration.
 * Frozen object - cannot be modified at runtime.
 */
export const CONFIG = loadConfig();

// Re-export types for convenience
export type { GameConfig, ViewportConfig, LevelConfig, GameplayConfig, BiomeConfig } from './schemas.js';
