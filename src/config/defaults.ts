/**
 * Default configuration values for Infinite Corridor.
 * These can be overridden via environment variables.
 */

import type { GameConfig } from './schemas.js';

export const DEFAULT_CONFIG: GameConfig = {
  viewport: {
    minWidth: 80,
    minHeight: 24,
    uiChromeHeight: 8,
    sidebarWidth: 0, // No sidebar by default, map fills terminal
  },

  level: {
    width: 120,
    height: 60,
  },

  gameplay: {
    playerFovRadius: 15, // Increased from 8 for open wilderness feel
    monsterDetectionRangeSq: 15 * 15, // 225, matches FOV radius
    monsterRespawnTurns: 50,
  },

  biome: {
    treeDensity: 0.15, // 15% tree coverage (sparse, open)
    waterChance: 0.05, // 5% water features
    clearingCount: 4, // Number of open clearings
    pathWindiness: 0.3, // Moderate path curves
    treeMinSpacing: 2, // Trees spaced at least 2 tiles apart
  },

  server: {
    port: 3000,
    useAiAdapter: false, // Default to mock unless API key present
  },

  client: {
    serverUrl: 'http://localhost:3000',
  },
};
