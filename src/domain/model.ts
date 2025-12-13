// Core domain model for Infinite Corridor.
// This file is intentionally free of runtime code: it's just types and interfaces.
// Everything else (engine, server, client, AI) should import these types.

// Import and re-export TileKind and TileFlavor from tiles module (single source of truth)
import type { TileKind as TileKindType, TileFlavor as TileFlavorType } from './tiles.js';
export type TileKind = TileKindType;
export type TileFlavor = TileFlavorType;

export type Position = {
  x: number;
  y: number;
};

export type Direction = 'Up' | 'Down' | 'Left' | 'Right';

export type EntityId = string;
export type EnemyTemplateId = string;
export type LevelId = string;

// ---- World Coordinates ----

// Grid coordinates for level positioning in the world
export interface LevelCoord {
  x: number;
  y: number;
}

// Edge connecting two levels via transition tiles
export interface LevelEdge {
  id: string;                    // Unique edge ID
  fromLevelId: LevelId;
  fromPosition: Position;        // Transition tile location in source level
  toLevelId: LevelId;
  toPosition: Position;          // Spawn location in destination level
}

// Stored level data for serialization/compression
export interface StoredLevel {
  level: LevelState;
  coord: LevelCoord;             // Grid position in world
  compressedAt: number;          // Turn when level was last left (for respawn timer)
  // Per-level flavor so returning to a level preserves its unique theming
  tileFlavors?: Partial<Record<TileKind, TileFlavor>>;
  enemyFlavors?: Record<string, EnemyFlavor>;
  roomDescription?: string;
}

// World state containing all level data
export interface WorldState {
  levels: Record<LevelId, StoredLevel>;  // All visited levels
  edges: LevelEdge[];                     // Connections between levels
  currentLevelId: LevelId;                // Active level
  offlinePlayers?: Record<EntityId, Position>; // Last known positions for disconnected players
}

// ---- Entities ----

export type Entity = Player | Monster | Item;
export type EntityKind = Entity['kind'];

// Common shape shared by all entities on the map.
export interface BaseEntity<K extends EntityKind> {
  id: EntityId;
  kind: K;
  position: Position;
}

// Player has stats and a name. You can extend this with DnD-style attributes later.
export interface Player extends BaseEntity<'Player'> {
  name: string;
  description: string;
  tokenChar: string;
  tokenColor?: string;
  hp: number;
  maxHp: number;
  // Simple stats to start. You can grow this as needed.
  strength: number;
  agility: number;
  intellect: number;
  // Leveling
  level: number;
  xp: number;
  xpToNext: number;
}

// Monster references an EnemyTemplate (mechanical palette) and has its own HP.
export interface Monster extends BaseEntity<'Monster'> {
  templateId: EnemyTemplateId;
  hp: number;
  maxHp: number;
}

// Simple on-ground item entity (could later be split into inventory vs map items).
export interface Item extends BaseEntity<'Item'> {
  name: string;
  // In v1, items are just descriptive. Later you can add stats/effects.
}


// ---- Actions ----

// Player actions are discriminated by `kind`. Engine logic will switch on this.
export type Action =
  | MoveAction
  | WaitAction
  | AttackAction
  | TransitionAction
  | CommandAction;

// Move in a direction (WASD-style).
export type MoveAction = {
  kind: 'Move';
  direction: Direction;
};

// Do nothing for a turn.
export type WaitAction = {
  kind: 'Wait';
};

// Attack in a given direction (engine is responsible for resolving target).
export type AttackAction = {
  kind: 'Attack';
  direction: Direction;
};

// Use a transition tile to move to another level.
export type TransitionAction = {
  kind: 'Transition';
};

// Send a text command to be parsed by the server (chat/inspect/abilities, etc).
export type CommandAction = {
  kind: 'Command';
  text: string;
};

// ---- Enemy templates & abilities ----

export type EnemyRole = 'Common' | 'Elite' | 'Boss';

// Simple numeric stats for enemies. You can expand this gradually.
export interface EnemyStats {
  maxHp: number;
  attack: number;
  defense: number;
  speed: number; // turn order / initiative
}

// Engine-level ability kinds. Keep this set small and extend carefully.
export type EnemyAbilityKind =
  | 'MeleeAttack'
  | 'RangedAttack'
  | 'Stun'
  | 'Debuff';

// Each ability variant can carry numeric parameters.
// Keep this intentionally boring and explicit.
export type EnemyAbility =
  | {
    kind: 'MeleeAttack';
    damage: number;
    accuracy: number;
  }
  | {
    kind: 'RangedAttack';
    damage: number;
    accuracy: number;
    range: number;
  }
  | {
    kind: 'Stun';
    chance: number;
    duration: number;
  }
  | {
    kind: 'Debuff';
    chance: number;
    // You can later add which stat gets debuffed.
  };

// Purely mechanical enemy template – no names or descriptions here.
export interface EnemyTemplate {
  id: EnemyTemplateId;
  cr: number; // "challenge rating" or difficulty tier.
  role: EnemyRole;
  stats: EnemyStats;
  abilities: EnemyAbility[];
  tags: string[]; // e.g. ['fast', 'ranged', 'fragile'] – passed to AI for flavor.
}

// AI-owned flavor for an enemy template.
export interface EnemyFlavor {
  name: string;
  shortDescription: string;
  longDescription?: string;
}

// ---- World config & game state ----

// High-level config chosen from the Infinite Corridor hub screen.
export interface WorldConfig {
  themePrompt: string; // free-form description of the universe from the player.
  seed: string;        // string seed input; engine can hash this to a number.
  difficulty: 'Easy' | 'Normal' | 'Hard';
  rulesVersion: string; // to keep old runs reproducible across rules changes.
}

// One floor / level of the dungeon.
// Important: tiles + entities + any per-level data you need.
export type TileIndex = number;

export interface MonsterSpawn {
  id: string;
  templateId: EnemyTemplateId;
  position: Position;
  maxHp: number;
  lastSpawnedTurn?: number;
  lastDefeatedTurn?: number;
}

export interface LevelState {
  id: LevelId;
  depth: number; // e.g. 1 for first floor, etc.

  width: number;
  height: number;

  // Tile grid stored as a 1D array; tile at (x, y) is tiles[y * width + x].
  tiles: TileKind[];

  // Entities currently present on this level (player, monsters, items).
  entities: Entity[];

  // Simple fog-of-war or "has player seen this tile?" tracking.
  discovered: boolean[]; // same indexing as tiles.

  // Spawn definitions for monsters that can respawn.
  monsterSpawns?: MonsterSpawn[];
}

// Game message for the log
export type GameMessageKind = 'info' | 'combat' | 'flavor' | 'system' | 'chat' | 'level';

export interface GameMessage {
  turn: number;
  ts: number;  // Unix timestamp (ms since epoch)
  text: string;
  kind: GameMessageKind;
}

// Full game state for a single run.
export interface GameState {
  worldConfig: WorldConfig;
  seed: number;         // numeric RNG seed derived from worldConfig.seed
  world: WorldState;    // Multi-level world state
  currentLevel: LevelState;  // Convenience reference to active level
  playerId: EntityId;
  turn: number;
  messages: GameMessage[];
  // AI-generated flavor, keyed by template ID
  enemyFlavors: Record<EnemyTemplateId, EnemyFlavor>;
  // AI-generated tile theming, keyed by abstract tile kind
  tileFlavors: Partial<Record<TileKind, TileFlavor>>;
  roomDescription?: string;
}
