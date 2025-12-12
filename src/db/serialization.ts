import { z } from 'zod';
import type { EnemyFlavor, GameState, LevelState, TileFlavor, TileKind } from '../domain/model.js';

const levelStateSchema = z.object({
  id: z.string(),
  depth: z.number(),
  width: z.number(),
  height: z.number(),
  tiles: z.array(z.string()),
  discovered: z.array(z.boolean()),
  entities: z.array(z.unknown()),
}).passthrough();

const tileFlavorSchema: z.ZodType<Partial<Record<TileKind, TileFlavor>>> = z.record(
  z.string(),
  z.object({
    name: z.string().optional(),
    shortDescription: z.string().optional(),
    longDescription: z.string().optional(),
    char: z.string().optional(),
    fg: z.string().optional(),
  }).passthrough()
);

const enemyFlavorSchema: z.ZodType<Record<string, EnemyFlavor>> = z.record(
  z.object({
    name: z.string(),
    shortDescription: z.string(),
    longDescription: z.string().optional(),
  }).passthrough()
);

export function serializeLevel(level: LevelState): string {
  return JSON.stringify(level);
}

export function deserializeLevel(json: string): LevelState {
  const parsed = levelStateSchema.parse(JSON.parse(json));
  return parsed as LevelState;
}

export function serializeTileFlavors(tileFlavors?: Partial<Record<TileKind, TileFlavor>>): string | null {
  return tileFlavors ? JSON.stringify(tileFlavors) : null;
}

export function serializeEnemyFlavors(enemyFlavors?: Record<string, EnemyFlavor>): string | null {
  return enemyFlavors ? JSON.stringify(enemyFlavors) : null;
}

export function deserializeTileFlavors(json: string | null | undefined): Partial<Record<TileKind, TileFlavor>> | undefined {
  if (!json) return undefined;
  return tileFlavorSchema.parse(JSON.parse(json));
}

export function deserializeEnemyFlavors(json: string | null | undefined): Record<string, EnemyFlavor> | undefined {
  if (!json) return undefined;
  return enemyFlavorSchema.parse(JSON.parse(json));
}

const gameStateSchema = z.object({
  worldConfig: z.object({
    themePrompt: z.string(),
    seed: z.string(),
    difficulty: z.string(),
    rulesVersion: z.string(),
  }).passthrough(),
  seed: z.number(),
  world: z.object({
    levels: z.record(z.object({
      level: z.any(),
      coord: z.object({ x: z.number(), y: z.number() }),
      compressedAt: z.number(),
      tileFlavors: z.any().optional(),
      enemyFlavors: z.any().optional(),
      roomDescription: z.string().optional(),
    }).passthrough()),
    edges: z.array(z.any()),
    currentLevelId: z.string(),
  }).passthrough(),
  currentLevel: z.any(),
  playerId: z.string(),
  turn: z.number(),
  messages: z.array(z.any()),
  enemyFlavors: z.any(),
  tileFlavors: z.any(),
  roomDescription: z.string().optional(),
}).passthrough();

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGameState(json: string): GameState {
  const parsed = gameStateSchema.parse(JSON.parse(json));
  return parsed as GameState;
}
