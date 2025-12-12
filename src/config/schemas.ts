/**
 * Zod schemas for game configuration validation.
 * All config values are validated at startup to catch errors early.
 */

import { z } from 'zod';

// ---- Viewport Configuration ----

export const ViewportSchema = z.object({
  /** Minimum terminal width to support */
  minWidth: z.number().int().min(40).max(300),
  /** Minimum terminal height to support */
  minHeight: z.number().int().min(16).max(150),
  /** Height reserved for UI chrome (status bar, messages, help) */
  uiChromeHeight: z.number().int().min(4).max(20),
  /** Width reserved for sidebar (if any) */
  sidebarWidth: z.number().int().min(0).max(40),
});

export type ViewportConfig = z.infer<typeof ViewportSchema>;

// ---- Level Configuration ----

export const LevelSchema = z.object({
  /** Default level width in tiles */
  width: z.number().int().min(40).max(200),
  /** Default level height in tiles */
  height: z.number().int().min(20).max(120),
});

export type LevelConfig = z.infer<typeof LevelSchema>;

// ---- Gameplay Configuration ----

export const GameplaySchema = z.object({
  /** Player field of view radius */
  playerFovRadius: z.number().int().min(3).max(30),
  /** Squared distance for monster detection (use squared for perf) */
  monsterDetectionRangeSq: z.number().int().min(25),
});

export type GameplayConfig = z.infer<typeof GameplaySchema>;

// ---- Biome Configuration ----

export const BiomeSchema = z.object({
  /** Percentage of map covered in trees (0.0 - 1.0) */
  treeDensity: z.number().min(0).max(1),
  /** Chance of water features (0.0 - 1.0) */
  waterChance: z.number().min(0).max(1),
  /** Number of open clearings to generate */
  clearingCount: z.number().int().min(1).max(20),
  /** How much paths wind (0 = straight, 1 = very curvy) */
  pathWindiness: z.number().min(0).max(1),
  /** Minimum spacing between trees */
  treeMinSpacing: z.number().int().min(0).max(5),
});

export type BiomeConfig = z.infer<typeof BiomeSchema>;

// ---- Server Configuration ----

export const ServerSchema = z.object({
  /** Server port */
  port: z.number().int().min(1024).max(65535),
  /** Whether to use real AI adapter (vs mock) */
  useAiAdapter: z.boolean(),
});

export type ServerConfig = z.infer<typeof ServerSchema>;

// ---- Client Configuration ----

export const ClientSchema = z.object({
  /** Server URL to connect to */
  serverUrl: z.string().url(),
});

export type ClientConfig = z.infer<typeof ClientSchema>;

// ---- Full Game Configuration ----

export const GameConfigSchema = z.object({
  viewport: ViewportSchema,
  level: LevelSchema,
  gameplay: GameplaySchema,
  biome: BiomeSchema,
  server: ServerSchema,
  client: ClientSchema,
});

export type GameConfig = z.infer<typeof GameConfigSchema>;
