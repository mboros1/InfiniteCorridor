import { z } from 'zod';
import type {
  EnemyFlavor,
  GameState,
  LevelState,
  TileFlavor,
  TileKind,
  Entity,
  Position,
  GameMessage,
  GameMessageKind,
  WorldState,
  LevelEdge,
  LevelCoord,
  StoredLevel,
  WorldConfig
} from '../domain/model.js';
import { TILE_DATA } from '../domain/tiles.js';

// Entity schema with discriminated union for entity kinds
const baseEntitySchema = z.object({
  id: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

const playerEntitySchema = baseEntitySchema.extend({
  kind: z.literal('Player'),
  name: z.string(),
  hp: z.number(),
  maxHp: z.number(),
  strength: z.number(),
  agility: z.number(),
  intellect: z.number(),
});

const monsterEntitySchema = baseEntitySchema.extend({
  kind: z.literal('Monster'),
  templateId: z.string(),
  hp: z.number(),
  maxHp: z.number(),
});

const itemEntitySchema = baseEntitySchema.extend({
  kind: z.literal('Item'),
  name: z.string(),
});

const entitySchema: z.ZodType<Entity> = z.discriminatedUnion('kind', [
  playerEntitySchema,
  monsterEntitySchema,
  itemEntitySchema,
]);

// Game message schema
const gameMessageSchema: z.ZodType<GameMessage> = z.object({
  turn: z.number(),
  text: z.string(),
  kind: z.custom<GameMessageKind>((val) => 
    ['info', 'combat', 'flavor', 'system'].includes(val as string)
  ),
});

// Tile flavor schema with validation
const tileFlavorSchema: z.ZodType<Partial<Record<TileKind, TileFlavor>>> = z.record(
  z.custom<TileKind>((val) => val in TILE_DATA),
  z.object({
    name: z.string(),
    char: z.string().min(1),
    fg: z.string().regex(/^#([0-9A-F]{3}){1,2}$/i),
    bg: z.string().regex(/^#([0-9A-F]{3}){1,2}$/i).optional(),
    description: z.string().optional(),
  })
);

// Enemy flavor schema with validation
const enemyFlavorSchema: z.ZodType<Record<string, EnemyFlavor>> = z.record(
  z.string(),
  z.object({
    name: z.string().min(1),
    shortDescription: z.string().min(1),
    longDescription: z.string().optional(),
  })
);

// Level state schema with proper typing
const levelStateSchema: z.ZodType<LevelState> = z.object({
  id: z.string(),
  depth: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tiles: z.array(z.custom<TileKind>((val) => val in TILE_DATA)),
  discovered: z.array(z.boolean()),
  entities: z.array(entitySchema),
});

export function serializeLevel(level: LevelState): string {
  // Validate before serialization to catch issues early
  levelStateSchema.parse(level);
  return JSON.stringify(level);
}

export function deserializeLevel(json: string): LevelState {
  return levelStateSchema.parse(JSON.parse(json));
}

export function serializeTileFlavors(tileFlavors?: Partial<Record<TileKind, TileFlavor>>): string | null {
  if (!tileFlavors) return null;
  // Validate before serialization
  tileFlavorSchema.parse(tileFlavors);
  return JSON.stringify(tileFlavors);
}

export function serializeEnemyFlavors(enemyFlavors?: Record<string, EnemyFlavor>): string | null {
  if (!enemyFlavors) return null;
  // Validate before serialization
  enemyFlavorSchema.parse(enemyFlavors);
  return JSON.stringify(enemyFlavors);
}

export function deserializeTileFlavors(json: string | null | undefined): Partial<Record<TileKind, TileFlavor>> | undefined {
  if (!json) return undefined;
  return tileFlavorSchema.parse(JSON.parse(json));
}

export function deserializeEnemyFlavors(json: string | null | undefined): Record<string, EnemyFlavor> | undefined {
  if (!json) return undefined;
  return enemyFlavorSchema.parse(JSON.parse(json));
}

// World config schema
const worldConfigSchema: z.ZodType<WorldConfig> = z.object({
  themePrompt: z.string().min(1),
  seed: z.string().min(1),
  difficulty: z.union([
    z.literal('Easy'),
    z.literal('Normal'), 
    z.literal('Hard')
  ]),
  rulesVersion: z.string().min(1),
});

// Position schema
const positionSchema: z.ZodType<Position> = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

// Level edge schema
const levelEdgeSchema: z.ZodType<LevelEdge> = z.object({
  id: z.string(),
  fromLevelId: z.string(),
  fromPosition: positionSchema,
  toLevelId: z.string(),
  toPosition: positionSchema,
});

// Level coord schema
const levelCoordSchema: z.ZodType<LevelCoord> = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

// Stored level schema
const storedLevelSchema: z.ZodType<StoredLevel> = z.object({
  level: levelStateSchema,
  coord: levelCoordSchema,
  compressedAt: z.number().int().nonnegative(),
  tileFlavors: tileFlavorSchema.optional(),
  enemyFlavors: enemyFlavorSchema.optional(),
  roomDescription: z.string().optional(),
});

// World state schema
const worldStateSchema: z.ZodType<WorldState> = z.object({
  levels: z.record(storedLevelSchema),
  edges: z.array(levelEdgeSchema),
  currentLevelId: z.string(),
});

// Game state schema with proper typing
const gameStateSchema: z.ZodType<GameState> = z.object({
  worldConfig: worldConfigSchema,
  seed: z.number().int(),
  world: worldStateSchema,
  currentLevel: levelStateSchema,
  playerId: z.string(),
  turn: z.number().int().nonnegative(),
  messages: z.array(gameMessageSchema),
  enemyFlavors: enemyFlavorSchema,
  tileFlavors: tileFlavorSchema,
  roomDescription: z.string().optional(),
});

export function serializeGameState(state: GameState): string {
  // Validate before serialization to catch issues early
  gameStateSchema.parse(state);
  return JSON.stringify(state);
}

export function deserializeGameState(json: string): GameState {
  return gameStateSchema.parse(JSON.parse(json));
}
