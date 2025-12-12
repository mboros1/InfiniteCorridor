/**
 * Abstract tile type system for Infinite Corridor.
 *
 * Architecture:
 * - TileKind: Abstract semantic types (not theme-specific)
 * - TileProperties: Behavior (walkable, transparent, etc.)
 * - TileRender: Default display (can be overridden by AI theming)
 * - TILE_DATA: Single source of truth registry
 *
 * The AI can provide themed alternatives for each abstract tile type.
 * For example, "TallObstacle" could be a tree, lamp post, or giant mushroom
 * depending on the world theme.
 */

// ---- Tile Kind Union ----

/**
 * Abstract tile types - semantic meaning, not visual appearance.
 * AI theming provides visual interpretation for each type.
 */
export type TileKind =
  // Ground types (walkable surfaces)
  | 'OpenGround'        // Basic walkable surface (grass, sand, carpet, dust)
  | 'DenseGround'       // Walkable but obscuring (tall grass, vines, fog)
  | 'BareGround'        // Exposed surface (dirt, stone, metal)
  | 'TraveledGround'    // Well-used path (trail, road, cleared corridor)
  | 'SlowGround'        // Difficult terrain (mud, deep sand, rubble)
  | 'OpenSpace'         // Clear open area (clearing, plaza, chamber)
  | 'GroundDetail'      // Decorative ground feature (flowers, crystals, runes)
  // Obstacles (impassable)
  | 'TallObstacle'      // Large vertical blocker (tree, pillar, statue, lamp post)
  | 'DamagedTallObstacle' // Damaged/dead version (dead tree, broken pillar)
  | 'LowObstacle'       // Smaller blocker (bush, crate, rubble pile)
  | 'SmallObstacle'     // Tiny obstacle, doesn't block LOS (rock, debris)
  | 'LargeObstacle'     // Massive blocker (boulder, monolith)
  | 'FallenObstacle'    // Toppled/fallen thing (fallen tree, collapsed beam)
  | 'ObstacleRemnant'   // Base/stump of removed obstacle (stump, pedestal)
  // Liquids
  | 'DeepLiquid'        // Deep impassable liquid (water, lava, acid, void)
  | 'ShallowLiquid'     // Passable liquid (stream, puddle, shallow lava)
  // Structures
  | 'FloorBuilt'        // Man-made floor (wood floor, tiles, metal grating)
  | 'WallSolid'         // Solid wall (stone, metal, force field)
  | 'WallFragile'       // Destructible wall (wood, glass, ice)
  | 'Barrier'           // See-through barrier (fence, bars, energy field)
  | 'Portal'            // Window/opening (window, viewport, gap)
  | 'DoorClosed'        // Closed passage
  | 'DoorOpen'          // Open passage
  // Special / Transitions
  | 'ExitDown'          // Descent point (stairs, hole, portal)
  | 'ExitUp'            // Ascent point (stairs, ladder, portal)
  | 'Transition';       // Passage to another level (door, cave mouth, portal, path into fog)

// ---- Tile Properties Interface ----

/**
 * Behavioral properties of a tile.
 */
export interface TileProperties {
  /** Can entities walk on this tile? */
  walkable: boolean;
  /** Does this tile block line of sight? */
  transparent: boolean;
  /** Movement cost multiplier (1.0 = normal, >1 = slower, Infinity = blocked) */
  movementCost: number;
  /** Can this tile be swum through? */
  swimmable?: boolean;
  /** Can this tile be destroyed? */
  destructible?: boolean;
}

// ---- Tile Render Interface ----

/**
 * Visual representation of a tile.
 * These are defaults - AI theming can override.
 */
export interface TileRender {
  /** Character to display */
  char: string;
  /** Foreground color (hex, e.g. '#4a7c59') */
  fg: string;
  /** Background color (hex, optional) */
  bg?: string;
  /** Alternative characters for visual variety (randomly selected) */
  altChars?: string[];
}

/**
 * AI-provided tile flavor for theming.
 */
export interface TileFlavor {
  /** Themed name (e.g., "Oak Tree", "Crystal Spire", "Neon Lamp Post") */
  name: string;
  /** Display character override */
  char: string;
  /** Foreground color override (hex) */
  fg: string;
  /** Background color override (hex, optional) */
  bg?: string;
  /** Short description for inspection */
  description?: string;
}

// ---- Combined Tile Data ----

export type TileData = TileProperties & TileRender;

// ---- Default Color Palette ----
// Neutral/generic colors - AI theming provides theme-specific colors

const COLORS = {
  // Ground tones
  groundLight: '#5a8c5a',
  groundMid: '#4a7c4a',
  groundDark: '#3a6c3a',
  groundDense: '#3a5c3a',
  groundBare: '#8b7355',
  groundPath: '#c4a35a',
  groundSlow: '#5c4a3a',
  groundSlowBg: '#4a3a2a',

  // Obstacle tones
  obstacleTall: '#2d5a2d',
  obstacleDamaged: '#8b7355',
  obstacleLow: '#4a6b3a',
  obstacleSmall: '#808080',
  obstacleLarge: '#707070',

  // Liquid tones
  liquidDeep: '#4169e1',
  liquidDeepBg: '#1a2a5a',
  liquidShallow: '#6495ed',
  liquidShallowBg: '#2a3a6a',

  // Structure tones
  floorBuilt: '#deb887',
  wallSolid: '#909090',
  wallFragile: '#b8860b',
  barrier: '#8b4513',
  portal: '#00ced1',

  // Detail tones
  detail: '#ff69b4',

  // Special
  exit: '#ffffff',

  // UI
  undiscovered: '#1a1a1a',
} as const;

// ---- Tile Data Registry ----

/**
 * Default tile data for all abstract types.
 * AI theming can override the visual properties.
 */
export const TILE_DATA: Record<TileKind, TileData> = {
  // === Ground Types ===

  OpenGround: {
    char: '.',
    fg: COLORS.groundLight,
    walkable: true,
    transparent: true,
    movementCost: 1.0,
    altChars: ['.', "'", '`'],
  },

  DenseGround: {
    char: '"',
    fg: COLORS.groundDense,
    walkable: true,
    transparent: false, // Blocks LOS
    movementCost: 1.2,
    altChars: ['"', ',', ';'],
  },

  BareGround: {
    char: '.',
    fg: COLORS.groundBare,
    walkable: true,
    transparent: true,
    movementCost: 1.0,
  },

  TraveledGround: {
    char: '·',
    fg: COLORS.groundPath,
    walkable: true,
    transparent: true,
    movementCost: 0.8, // Slightly faster
  },

  SlowGround: {
    char: '~',
    fg: COLORS.groundSlow,
    bg: COLORS.groundSlowBg,
    walkable: true,
    transparent: true,
    movementCost: 1.5,
  },

  OpenSpace: {
    char: '.',
    fg: COLORS.groundLight,
    walkable: true,
    transparent: true,
    movementCost: 1.0,
  },

  GroundDetail: {
    char: '*',
    fg: COLORS.detail,
    walkable: true,
    transparent: true,
    movementCost: 1.0,
    altChars: ['*', ',', '.'],
  },

  // === Obstacles ===

  TallObstacle: {
    char: '♣',
    fg: COLORS.obstacleTall,
    walkable: false,
    transparent: false,
    movementCost: Infinity,
    altChars: ['♣', '♠', 'T'],
  },

  DamagedTallObstacle: {
    char: '†',
    fg: COLORS.obstacleDamaged,
    walkable: false,
    transparent: false,
    movementCost: Infinity,
    destructible: true,
  },

  LowObstacle: {
    char: '*',
    fg: COLORS.obstacleLow,
    walkable: false,
    transparent: false,
    movementCost: Infinity,
    destructible: true,
  },

  SmallObstacle: {
    char: '○',
    fg: COLORS.obstacleSmall,
    walkable: false,
    transparent: true, // Doesn't block LOS
    movementCost: Infinity,
  },

  LargeObstacle: {
    char: '●',
    fg: COLORS.obstacleLarge,
    walkable: false,
    transparent: false,
    movementCost: Infinity,
  },

  FallenObstacle: {
    char: '=',
    fg: COLORS.obstacleDamaged,
    walkable: false,
    transparent: true,
    movementCost: Infinity,
    destructible: true,
  },

  ObstacleRemnant: {
    char: 'o',
    fg: COLORS.obstacleDamaged,
    walkable: false,
    transparent: true,
    movementCost: Infinity,
  },

  // === Liquids ===

  DeepLiquid: {
    char: '≈',
    fg: COLORS.liquidDeep,
    bg: COLORS.liquidDeepBg,
    walkable: false,
    transparent: true,
    movementCost: Infinity,
    swimmable: true,
    altChars: ['≈', '~', '∼'],
  },

  ShallowLiquid: {
    char: '~',
    fg: COLORS.liquidShallow,
    bg: COLORS.liquidShallowBg,
    walkable: true,
    transparent: true,
    movementCost: 2.0,
    swimmable: true,
  },

  // === Structures ===

  FloorBuilt: {
    char: '.',
    fg: COLORS.floorBuilt,
    walkable: true,
    transparent: true,
    movementCost: 1.0,
  },

  WallSolid: {
    char: '#',
    fg: COLORS.wallSolid,
    walkable: false,
    transparent: false,
    movementCost: Infinity,
  },

  WallFragile: {
    char: '#',
    fg: COLORS.wallFragile,
    walkable: false,
    transparent: false,
    movementCost: Infinity,
    destructible: true,
  },

  Barrier: {
    char: '|',
    fg: COLORS.barrier,
    walkable: false,
    transparent: true, // Can see through
    movementCost: Infinity,
    destructible: true,
  },

  Portal: {
    char: '□',
    fg: COLORS.portal,
    walkable: false,
    transparent: true,
    movementCost: Infinity,
  },

  DoorClosed: {
    char: '+',
    fg: COLORS.barrier,
    walkable: false,
    transparent: false,
    movementCost: Infinity,
  },

  DoorOpen: {
    char: '/',
    fg: COLORS.barrier,
    walkable: true,
    transparent: true,
    movementCost: 1.0,
  },

  // === Special ===

  ExitDown: {
    char: '>',
    fg: COLORS.exit,
    walkable: true,
    transparent: true,
    movementCost: 1.0,
  },

  ExitUp: {
    char: '<',
    fg: COLORS.exit,
    walkable: true,
    transparent: true,
    movementCost: 1.0,
  },

  Transition: {
    char: '◊',
    fg: COLORS.exit,
    walkable: true,
    transparent: true,
    movementCost: 1.0,
  },
} as const;

// ---- Utility Functions ----

/**
 * Get full tile data for a tile kind.
 */
export function getTileData(kind: TileKind): TileData {
  return TILE_DATA[kind];
}

/**
 * Check if a tile is walkable.
 */
export function isWalkable(kind: TileKind | null): boolean {
  if (kind === null) return false;
  return TILE_DATA[kind].walkable;
}

/**
 * Check if a tile is transparent (doesn't block LOS).
 */
export function isTransparent(kind: TileKind | null): boolean {
  if (kind === null) return true;
  return TILE_DATA[kind].transparent;
}

/**
 * Get movement cost for a tile.
 */
export function getMovementCost(kind: TileKind): number {
  return TILE_DATA[kind].movementCost;
}

/**
 * Get the render character for a tile.
 * If tileFlavors are provided and have an override, use that.
 * Otherwise picks from altChars based on position for visual variety.
 */
export function getTileChar(
  kind: TileKind,
  x?: number,
  y?: number,
  tileFlavors?: Record<TileKind, TileFlavor>
): string {
  // Check for AI-provided flavor override
  if (tileFlavors?.[kind]) {
    return tileFlavors[kind].char;
  }

  const data = TILE_DATA[kind];
  if (data.altChars && x !== undefined && y !== undefined) {
    // Use position to deterministically pick an alt char
    const index = (x * 7 + y * 13) % data.altChars.length;
    return data.altChars[index];
  }
  return data.char;
}

/**
 * Get tile foreground color.
 * If tileFlavors are provided and have an override, use that.
 */
export function getTileFg(
  kind: TileKind,
  tileFlavors?: Record<TileKind, TileFlavor>
): string {
  if (tileFlavors?.[kind]) {
    return tileFlavors[kind].fg;
  }
  return TILE_DATA[kind].fg;
}

/**
 * Get tile background color (may be undefined).
 * If tileFlavors are provided and have an override, use that.
 */
export function getTileBg(
  kind: TileKind,
  tileFlavors?: Record<TileKind, TileFlavor>
): string | undefined {
  if (tileFlavors?.[kind]?.bg) {
    return tileFlavors[kind].bg;
  }
  return TILE_DATA[kind].bg;
}

// ---- Entity Colors ----
// Colors for rendering entities on the map

export const ENTITY_COLORS: Record<string, string> = {
  player: '#00ff00',
  monsterCommon: '#ff6600',
  monsterElite: '#ff3300',
  monsterBoss: '#ff0000',
  item: '#ffff00',
};

// ---- Undiscovered Tile ----

export const UNDISCOVERED_COLOR = COLORS.undiscovered;

// ---- Tile Kind Lists for AI Prompts ----

/**
 * Human-readable descriptions for each tile type.
 * Used in AI prompts to explain what each abstract type represents.
 */
export const TILE_DESCRIPTIONS: Record<TileKind, string> = {
  OpenGround: 'Basic walkable surface (grass, sand, carpet, dust, ash)',
  DenseGround: 'Walkable but vision-obscuring (tall grass, vines, fog, cobwebs)',
  BareGround: 'Exposed/cleared surface (dirt, stone floor, metal grating)',
  TraveledGround: 'Well-used path (trail, road, corridor, worn carpet)',
  SlowGround: 'Difficult terrain that slows movement (mud, deep sand, rubble)',
  OpenSpace: 'Clear open area (clearing, plaza, chamber center)',
  GroundDetail: 'Decorative ground feature (flowers, mushrooms, crystals, runes, candles)',
  TallObstacle: 'Large vertical blocker (tree, pillar, statue, lamp post, giant mushroom)',
  DamagedTallObstacle: 'Damaged/dead tall obstacle (dead tree, broken pillar, ruined statue)',
  LowObstacle: 'Smaller blocker (bush, crate, barrel, rubble pile, small shrine)',
  SmallObstacle: 'Tiny obstacle that does not block vision (rock, debris, furniture, bones)',
  LargeObstacle: 'Massive blocker (boulder, monolith, large machine)',
  FallenObstacle: 'Toppled/fallen thing (fallen tree, collapsed beam, toppled pillar)',
  ObstacleRemnant: 'Base/stump of removed obstacle (tree stump, pedestal, foundation)',
  DeepLiquid: 'Deep impassable liquid (water, lava, acid, void, quicksand)',
  ShallowLiquid: 'Passable liquid that slows movement (stream, puddle, shallow lava, mist)',
  FloorBuilt: 'Constructed floor (wood planks, stone tiles, metal grating)',
  WallSolid: 'Solid permanent wall (stone, metal, force field)',
  WallFragile: 'Destructible wall (wood, glass, ice)',
  Barrier: 'See-through barrier (fence, bars, energy field, railing)',
  Portal: 'Window or opening you cannot pass through (window, viewport, gap)',
  DoorClosed: 'Closed passage (door, gate, hatch)',
  DoorOpen: 'Open passage (open door, archway)',
  ExitDown: 'Descent point (stairs down, hole, portal, trapdoor)',
  ExitUp: 'Ascent point (stairs up, ladder, portal)',
  Transition: 'Passage to another area (door, cave mouth, portal, path into fog, archway)',
};
