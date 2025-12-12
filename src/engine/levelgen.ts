/**
 * Level generation for open wilderness style maps.
 *
 * Creates natural-looking terrain with:
 * - Open ground base with bare ground patches
 * - Scattered tall obstacles (sparse, not dense)
 * - Open clearings connected by paths
 * - Occasional liquid features
 * - Small and large obstacles
 *
 * Uses abstract tile types that AI can theme contextually.
 */

import type { Entity, EnemyTemplateId, LevelState, Monster, Position, LevelId, LevelCoord } from '../domain/model.js';
import type { TileKind } from '../domain/tiles.js';
import { CONFIG } from '../config/index.js';
import { debugLog } from '../utils/debug.js';
import type { RNG } from './rng.js';

// ---- Level Generation Result ----

export interface LevelGenResult {
  level: LevelState;
  transitionPositions: Position[];  // Where transition tiles are placed
}

// ---- Configuration ----

interface LevelGenConfig {
  width: number;
  height: number;
  depth: number;
  minClearingSize: number;
  maxClearingSize: number;
  clearingCount: number;
  enemyDensity: number;
}

interface Clearing {
  x: number;
  y: number;
  radius: number;
}

// ---- Noise Functions ----

/**
 * Simple value noise for terrain variation.
 * Returns value between 0 and 1.
 */
function valueNoise(x: number, y: number, seed: number): number {
  // Hash function for pseudo-random values
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 43.112) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Smoothed noise with interpolation.
 */
function smoothNoise(x: number, y: number, seed: number, scale: number): number {
  const sx = x / scale;
  const sy = y / scale;

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const fx = sx - x0;
  const fy = sy - y0;

  // Smooth interpolation
  const smoothFx = fx * fx * (3 - 2 * fx);
  const smoothFy = fy * fy * (3 - 2 * fy);

  const v00 = valueNoise(x0, y0, seed);
  const v10 = valueNoise(x1, y0, seed);
  const v01 = valueNoise(x0, y1, seed);
  const v11 = valueNoise(x1, y1, seed);

  const i0 = v00 * (1 - smoothFx) + v10 * smoothFx;
  const i1 = v01 * (1 - smoothFx) + v11 * smoothFx;

  return i0 * (1 - smoothFy) + i1 * smoothFy;
}

/**
 * Multi-octave noise for natural-looking terrain.
 */
function fractalNoise(x: number, y: number, seed: number, octaves: number = 3): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency, seed + i * 100, 8) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxValue;
}

// ---- Helper Functions ----

function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function clearingsOverlap(a: Clearing, b: Clearing, padding: number): boolean {
  return distance(a.x, a.y, b.x, b.y) < a.radius + b.radius + padding;
}

function setTile(tiles: TileKind[], width: number, x: number, y: number, tile: TileKind): void {
  if (x >= 0 && x < width && y >= 0 && y < (tiles.length / width)) {
    tiles[y * width + x] = tile;
  }
}

function getTileAt(tiles: TileKind[], width: number, x: number, y: number): TileKind | null {
  if (x >= 0 && x < width && y >= 0 && y < (tiles.length / width)) {
    return tiles[y * width + x];
  }
  return null;
}

// ---- Terrain Generation Functions ----

/**
 * Fill the map with base terrain using noise.
 */
function generateBaseTerrain(tiles: TileKind[], width: number, height: number, rng: RNG): void {
  const seed = rng.nextInt(10000);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const noise = fractalNoise(x, y, seed, 3);

      // Base terrain distribution using abstract types
      if (noise < 0.35) {
        tiles[y * width + x] = 'OpenGround';
      } else if (noise < 0.45) {
        tiles[y * width + x] = 'DenseGround';
      } else if (noise < 0.55) {
        tiles[y * width + x] = 'BareGround';
      } else if (noise < 0.7) {
        tiles[y * width + x] = 'OpenGround';
      } else {
        tiles[y * width + x] = 'DenseGround';
      }
    }
  }
}

/**
 * Scatter tall obstacles across the map with minimum spacing.
 */
function scatterTallObstacles(
  tiles: TileKind[],
  width: number,
  height: number,
  rng: RNG,
  density: number,
  minSpacing: number
): void {
  const obstaclePositions: { x: number; y: number }[] = [];

  // Calculate number of obstacles to place
  const targetCount = Math.floor(width * height * density);

  for (let attempt = 0; attempt < targetCount * 3 && obstaclePositions.length < targetCount; attempt++) {
    const x = rng.nextIntRange(1, width - 1);
    const y = rng.nextIntRange(1, height - 1);

    // Check minimum spacing from other obstacles
    const tooClose = obstaclePositions.some((pos) => distance(x, y, pos.x, pos.y) < minSpacing);
    if (tooClose) continue;

    // Don't place on special tiles
    const currentTile = tiles[y * width + x];
    if (currentTile === 'DeepLiquid' || currentTile === 'ShallowLiquid' || currentTile === 'TraveledGround') continue;

    // Place TallObstacle or DamagedTallObstacle
    const obstacleType: TileKind = rng.next() < 0.85 ? 'TallObstacle' : 'DamagedTallObstacle';
    tiles[y * width + x] = obstacleType;
    obstaclePositions.push({ x, y });
  }
}

/**
 * Add scattered small and large obstacles.
 */
function scatterObstacles(tiles: TileKind[], width: number, height: number, rng: RNG): void {
  const obstacleCount = Math.floor(width * height * 0.01); // 1% coverage

  for (let i = 0; i < obstacleCount; i++) {
    const x = rng.nextIntRange(1, width - 1);
    const y = rng.nextIntRange(1, height - 1);

    const currentTile = tiles[y * width + x];
    if (currentTile !== 'OpenGround' && currentTile !== 'BareGround' && currentTile !== 'DenseGround') continue;

    tiles[y * width + x] = rng.next() < 0.7 ? 'SmallObstacle' : 'LargeObstacle';
  }
}

/**
 * Add occasional ground detail patches.
 */
function scatterGroundDetails(tiles: TileKind[], width: number, height: number, rng: RNG): void {
  const detailPatches = rng.nextIntRange(3, 8);

  for (let i = 0; i < detailPatches; i++) {
    const centerX = rng.nextIntRange(5, width - 5);
    const centerY = rng.nextIntRange(5, height - 5);
    const radius = rng.nextIntRange(2, 4);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        if (rng.next() < 0.4) continue; // Sparse details

        const x = centerX + dx;
        const y = centerY + dy;

        const currentTile = getTileAt(tiles, width, x, y);
        if (currentTile === 'OpenGround' || currentTile === 'DenseGround') {
          setTile(tiles, width, x, y, 'GroundDetail');
        }
      }
    }
  }
}

/**
 * Carve a clearing (open space area).
 */
function carveClearing(tiles: TileKind[], width: number, clearing: Clearing): void {
  const { x: cx, y: cy, radius } = clearing;

  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dist = distance(x, y, cx, cy);
      if (dist <= radius) {
        setTile(tiles, width, x, y, 'OpenSpace');
      } else if (dist <= radius + 1) {
        // Soft edge with dense ground
        const currentTile = getTileAt(tiles, width, x, y);
        if (currentTile !== 'TallObstacle' && currentTile !== 'DamagedTallObstacle') {
          setTile(tiles, width, x, y, 'DenseGround');
        }
      }
    }
  }
}

/**
 * Carve a winding path between two points.
 */
function carvePath(
  tiles: TileKind[],
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rng: RNG,
  windiness: number
): void {
  let x = x1;
  let y = y1;

  // Safety limit to prevent infinite loops
  const maxSteps = Math.abs(x2 - x1) + Math.abs(y2 - y1) + 50;
  let steps = 0;

  while ((Math.abs(x - x2) > 1 || Math.abs(y - y2) > 1) && steps < maxSteps) {
    steps++;

    // Set current tile as traveled ground
    setTile(tiles, width, x, y, 'TraveledGround');

    // Determine direction toward target
    const dx = x2 - x;
    const dy = y2 - y;

    // Add some randomness for winding
    let moveX = 0;
    let moveY = 0;

    if (rng.next() < windiness && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      // Random perpendicular movement for windiness
      if (Math.abs(dx) > Math.abs(dy)) {
        moveY = rng.next() < 0.5 ? 1 : -1;
      } else {
        moveX = rng.next() < 0.5 ? 1 : -1;
      }
    } else {
      // Move toward target
      if (Math.abs(dx) > Math.abs(dy)) {
        moveX = dx > 0 ? 1 : -1;
      } else {
        moveY = dy > 0 ? 1 : -1;
      }
    }

    x += moveX;
    y += moveY;

    // Clamp to bounds
    x = Math.max(1, Math.min(width - 2, x));
    y = Math.max(1, Math.min((tiles.length / width) - 2, y));
  }

  // Set final tile ONLY if it's not a special tile (like Transition)
  const finalTile = getTileAt(tiles, width, x2, y2);
  if (finalTile !== 'Transition' && finalTile !== 'ExitDown' && finalTile !== 'ExitUp') {
    setTile(tiles, width, x2, y2, 'TraveledGround');
  }
}

/**
 * Add a liquid feature (pond or pool).
 */
function addLiquidFeature(tiles: TileKind[], width: number, height: number, rng: RNG): void {
  // Create a small pond
  const centerX = rng.nextIntRange(10, width - 10);
  const centerY = rng.nextIntRange(10, height - 10);
  const radius = rng.nextIntRange(3, 6);

  for (let y = centerY - radius - 1; y <= centerY + radius + 1; y++) {
    for (let x = centerX - radius - 1; x <= centerX + radius + 1; x++) {
      const dist = distance(x, y, centerX, centerY);

      if (dist <= radius - 1) {
        setTile(tiles, width, x, y, 'DeepLiquid');
      } else if (dist <= radius) {
        setTile(tiles, width, x, y, 'ShallowLiquid');
      } else if (dist <= radius + 1) {
        const currentTile = getTileAt(tiles, width, x, y);
        if (currentTile !== 'TallObstacle' && currentTile !== 'DeepLiquid') {
          setTile(tiles, width, x, y, 'SlowGround');
        }
      }
    }
  }
}

// ---- Level ID Generation ----

/**
 * Generate deterministic level ID from seed and grid coordinates.
 * Uses format: "level-{seedHash}-{x},{y}" for reproducibility.
 */
export function generateLevelId(seed: number, coord: LevelCoord): LevelId {
  const seedHash = seed.toString(16).slice(0, 8).padStart(8, '0');
  return `level-${seedHash}-${coord.x},${coord.y}`;
}

/**
 * Parse level ID back to coordinates.
 * Returns null if ID is invalid.
 */
export function parseLevelId(id: LevelId): LevelCoord | null {
  const match = id.match(/^level-[0-9a-f]+-(-?\d+),(-?\d+)$/);
  if (!match) return null;
  return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
}

// ---- Transition Placement ----

/**
 * Place transition tiles leading to adjacent levels.
 * Places them in clearings (except the first one where player spawns)
 * or extends paths toward map edges.
 */
function placeTransitionTiles(
  tiles: TileKind[],
  width: number,
  height: number,
  clearings: Clearing[],
  rng: RNG
): Position[] {
  debugLog('[DEBUG] placeTransitionTiles: starting, clearings:', clearings.length);
  const transitionPositions: Position[] = [];

  // Strategy: Place transitions in or near clearings that are closer to map edges
  // This makes them discoverable and naturally connected to the path network

  const directions: { name: string; dx: number; dy: number }[] = [
    { name: 'west', dx: -1, dy: 0 },
    { name: 'east', dx: 1, dy: 0 },
    { name: 'north', dx: 0, dy: -1 },
    { name: 'south', dx: 0, dy: 1 },
  ];

  for (const dir of directions) {
    debugLog(`[DEBUG] placeTransitionTiles: processing direction ${dir.name}`);
    // Find the clearing closest to this edge
    let bestClearing: Clearing | null = null;
    let bestEdgeDist = Infinity;

    for (let i = 1; i < clearings.length; i++) {  // Skip first clearing (player spawn)
      const clearing = clearings[i];
      let edgeDist: number;

      if (dir.dx < 0) edgeDist = clearing.x;  // Distance to left edge
      else if (dir.dx > 0) edgeDist = width - clearing.x;  // Distance to right edge
      else if (dir.dy < 0) edgeDist = clearing.y;  // Distance to top edge
      else edgeDist = height - clearing.y;  // Distance to bottom edge

      if (edgeDist < bestEdgeDist) {
        bestEdgeDist = edgeDist;
        bestClearing = clearing;
      }
    }

    if (!bestClearing) {
      debugLog(`[DEBUG] placeTransitionTiles: no clearing for ${dir.name}`);
      continue;
    }
    debugLog(`[DEBUG] placeTransitionTiles: best clearing for ${dir.name} at (${bestClearing.x},${bestClearing.y})`);

    // Place transition at edge of this clearing in the direction of the map edge
    // Find a walkable spot at the clearing's edge in this direction
    let transitionPos: Position | null = null;

    for (let dist = bestClearing.radius; dist < bestClearing.radius + 5; dist++) {
      const x = bestClearing.x + dir.dx * dist;
      const y = bestClearing.y + dir.dy * dist;

      if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) continue;

      const tile = getTileAt(tiles, width, x, y);

      // Check if this is a walkable tile we can place a transition on
      if (tile && tile !== 'TallObstacle' && tile !== 'DamagedTallObstacle' &&
          tile !== 'LargeObstacle' && tile !== 'DeepLiquid' && tile !== 'WallSolid') {
        transitionPos = { x, y };
        break;
      }
    }

    // Fallback: place at clearing edge if no good spot found
    if (!transitionPos) {
      const x = Math.max(2, Math.min(width - 3, bestClearing.x + dir.dx * bestClearing.radius));
      const y = Math.max(2, Math.min(height - 3, bestClearing.y + dir.dy * bestClearing.radius));
      transitionPos = { x, y };
    }
    debugLog(`[DEBUG] placeTransitionTiles: transition for ${dir.name} at (${transitionPos.x},${transitionPos.y})`);

    // Place the transition tile
    setTile(tiles, width, transitionPos.x, transitionPos.y, 'Transition');
    transitionPositions.push(transitionPos);

    // Carve a short path from clearing center to transition for visibility
    debugLog(`[DEBUG] placeTransitionTiles: carving path for ${dir.name}`);
    carvePath(tiles, width, bestClearing.x, bestClearing.y, transitionPos.x, transitionPos.y, rng, 0.1);
    debugLog(`[DEBUG] placeTransitionTiles: path carved for ${dir.name}`);
  }

  debugLog('[DEBUG] placeTransitionTiles: done, total:', transitionPositions.length);
  return transitionPositions;
}

// ---- Enemy Templates ----

function getEnemyTemplatesForDepth(depth: number): EnemyTemplateId[] {
  const templates: EnemyTemplateId[] = ['enemy-common-1'];
  if (depth >= 2) templates.push('enemy-common-2');
  if (depth >= 3) templates.push('enemy-elite-1');
  if (depth >= 5) templates.push('enemy-boss-1');
  return templates;
}

// ---- Main Generation Function ----

export function generateLevel(rng: RNG, config: LevelGenConfig): LevelGenResult {
  debugLog('[DEBUG] generateLevel: starting');
  const { width, height, depth, minClearingSize, maxClearingSize, clearingCount, enemyDensity } = config;

  // Initialize tiles array
  const tiles: TileKind[] = new Array(width * height);
  const discovered: boolean[] = new Array(width * height).fill(false);
  debugLog('[DEBUG] generateLevel: arrays initialized');

  // Step 1: Generate base terrain with noise
  generateBaseTerrain(tiles, width, height, rng);
  debugLog('[DEBUG] generateLevel: base terrain done');

  // Step 2: Generate clearings
  const clearings: Clearing[] = [];

  for (let attempt = 0; attempt < clearingCount * 10 && clearings.length < clearingCount; attempt++) {
    const radius = rng.nextIntRange(minClearingSize, maxClearingSize + 1);
    const x = rng.nextIntRange(radius + 2, width - radius - 2);
    const y = rng.nextIntRange(radius + 2, height - radius - 2);

    const newClearing: Clearing = { x, y, radius };

    // Check overlap with existing clearings
    const overlaps = clearings.some((c) => clearingsOverlap(c, newClearing, 4));
    if (!overlaps) {
      clearings.push(newClearing);
    }
  }
  debugLog('[DEBUG] generateLevel: clearings generated:', clearings.length);

  // Step 3: Scatter tall obstacles (before carving clearings so clearings override)
  scatterTallObstacles(tiles, width, height, rng, CONFIG.biome.treeDensity, CONFIG.biome.treeMinSpacing);
  debugLog('[DEBUG] generateLevel: obstacles scattered');

  // Step 4: Carve clearings (removes obstacles)
  for (const clearing of clearings) {
    carveClearing(tiles, width, clearing);
  }
  debugLog('[DEBUG] generateLevel: clearings carved');

  // Step 5: Connect clearings with paths
  debugLog('[DEBUG] generateLevel: connecting clearings with paths');
  for (let i = 1; i < clearings.length; i++) {
    const prev = clearings[i - 1];
    const curr = clearings[i];
    debugLog(`[DEBUG] generateLevel: path ${i} from (${prev.x},${prev.y}) to (${curr.x},${curr.y})`);
    carvePath(tiles, width, prev.x, prev.y, curr.x, curr.y, rng, CONFIG.biome.pathWindiness);
  }

  // Also connect last to first for a loop
  if (clearings.length > 2) {
    const first = clearings[0];
    const last = clearings[clearings.length - 1];
    debugLog(`[DEBUG] generateLevel: loop path from (${last.x},${last.y}) to (${first.x},${first.y})`);
    carvePath(tiles, width, last.x, last.y, first.x, first.y, rng, CONFIG.biome.pathWindiness);
  }
  debugLog('[DEBUG] generateLevel: paths done');

  // Step 6: Add liquid features
  if (rng.next() < CONFIG.biome.waterChance * 3) {
    addLiquidFeature(tiles, width, height, rng);
  }
  debugLog('[DEBUG] generateLevel: liquid features done');

  // Step 7: Add small obstacles and ground details
  scatterObstacles(tiles, width, height, rng);
  scatterGroundDetails(tiles, width, height, rng);
  debugLog('[DEBUG] generateLevel: details done');

  // Step 8: Place transition tiles at map edges
  debugLog('[DEBUG] generateLevel: placing transitions');
  const transitionPositions = placeTransitionTiles(tiles, width, height, clearings, rng);
  debugLog('[DEBUG] generateLevel: transitions placed:', transitionPositions.length);

  // Step 9: Place player in first clearing
  const playerClearing = clearings[0];
  const playerPos = { x: playerClearing.x, y: playerClearing.y };

  const entities: Entity[] = [
    {
      id: 'player-1',
      kind: 'Player',
      name: 'Unnamed Wanderer',
      position: playerPos,
      hp: 20,
      maxHp: 20,
      strength: 10,
      agility: 10,
      intellect: 10,
    },
  ];

  // Step 10: Place enemies in other clearings
  const availableTemplates = getEnemyTemplatesForDepth(depth);
  let enemyCount = 0;

  for (let i = 1; i < clearings.length; i++) {
    const clearing = clearings[i];
    const numEnemies = Math.max(1, Math.round(enemyDensity + (rng.next() - 0.5)));

    for (let e = 0; e < numEnemies; e++) {
      // Place enemy within clearing
      const angle = rng.next() * Math.PI * 2;
      const dist = rng.next() * (clearing.radius - 1);
      const enemyX = Math.round(clearing.x + Math.cos(angle) * dist);
      const enemyY = Math.round(clearing.y + Math.sin(angle) * dist);

      const templateId = rng.pick(availableTemplates);
      const monster: Monster = {
        id: `enemy-${++enemyCount}`,
        kind: 'Monster',
        templateId,
        position: { x: enemyX, y: enemyY },
        hp: 5 + depth * 2,
        maxHp: 5 + depth * 2,
      };

      entities.push(monster);
    }
  }

  const level: LevelState = {
    id: `level-${depth}`,  // Will be overwritten with proper ID by caller
    depth,
    width,
    height,
    tiles,
    discovered,
    entities,
  };

  return { level, transitionPositions };
}

export function getDefaultLevelConfig(depth: number, difficulty: 'Easy' | 'Normal' | 'Hard'): LevelGenConfig {
  const difficultyMultiplier = difficulty === 'Easy' ? 0.7 : difficulty === 'Hard' ? 1.3 : 1;

  return {
    width: CONFIG.level.width,
    height: CONFIG.level.height,
    depth,
    minClearingSize: 5,
    maxClearingSize: 10,
    clearingCount: CONFIG.biome.clearingCount + Math.floor(depth / 2),
    enemyDensity: Math.round((1 + depth * 0.5) * difficultyMultiplier),
  };
}

/**
 * Get all unique tile types present in a level.
 * Used to tell the AI which tiles need theming.
 */
export function getUniqueTileTypes(tiles: TileKind[]): TileKind[] {
  const uniqueTypes = new Set<TileKind>();
  for (const tile of tiles) {
    uniqueTypes.add(tile);
  }
  return Array.from(uniqueTypes);
}
