/**
 * ContextPanel component - Describes what's around the player.
 *
 * Shows terrain the player is standing on and what they can see
 * in each cardinal direction, using AI-themed tile and enemy names.
 * Enemy names are colored to stand out.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { GameState, TileFlavor, TileKind, EnemyFlavor, Monster, Player } from '../../domain/model.js';
import { ENTITY_COLORS } from '../../domain/tiles.js';

interface ContextPanelProps {
  state: GameState;
  playerEntityId?: string;
  width?: number;
}

// Get player from state
function getPlayer(state: GameState, playerEntityId?: string) {
  const id = playerEntityId ?? state.playerId;
  const entity = state.currentLevel.entities.find((e) => e.id === id);
  return entity?.kind === 'Player' ? entity : undefined;
}

// Get tile at position
function getTileAt(state: GameState, x: number, y: number): TileKind | null {
  const level = state.currentLevel;
  if (x < 0 || x >= level.width || y < 0 || y >= level.height) return null;
  return level.tiles[y * level.width + x];
}

// Get entities at position (can be multiple in theory)
function getEntitiesInArea(
  state: GameState,
  playerX: number,
  playerY: number,
  dx: number,
  dy: number,
  maxDist: number
): Monster[] {
  const monsters: Monster[] = [];
  const level = state.currentLevel;

  for (const entity of level.entities) {
    if (entity.kind !== 'Monster') continue;

    const ex = entity.position.x - playerX;
    const ey = entity.position.y - playerY;

    // Check if entity is in this direction
    if (dx !== 0) {
      // Horizontal direction
      if (Math.sign(ex) !== dx) continue;
      if (Math.abs(ex) > maxDist) continue;
      if (Math.abs(ey) > 1) continue; // Allow 1 tile off-axis
    } else {
      // Vertical direction
      if (Math.sign(ey) !== dy) continue;
      if (Math.abs(ey) > maxDist) continue;
      if (Math.abs(ex) > 1) continue; // Allow 1 tile off-axis
    }

    // Check if discovered
    const idx = entity.position.y * level.width + entity.position.x;
    if (!level.discovered[idx]) continue;

    monsters.push(entity);
  }

  return monsters;
}

function getPlayersInArea(
  state: GameState,
  playerX: number,
  playerY: number,
  dx: number,
  dy: number,
  maxDist: number,
  excludeEntityId?: string
): Player[] {
  const players: Player[] = [];
  const level = state.currentLevel;

  for (const entity of level.entities) {
    if (entity.kind !== 'Player') continue;
    if (excludeEntityId && entity.id === excludeEntityId) continue;

    const ex = entity.position.x - playerX;
    const ey = entity.position.y - playerY;

    if (dx !== 0) {
      if (Math.sign(ex) !== dx) continue;
      if (Math.abs(ex) > maxDist) continue;
      if (Math.abs(ey) > 1) continue;
    } else {
      if (Math.sign(ey) !== dy) continue;
      if (Math.abs(ey) > maxDist) continue;
      if (Math.abs(ex) > 1) continue;
    }

    const idx = entity.position.y * level.width + entity.position.x;
    if (!level.discovered[idx]) continue;

    players.push(entity);
  }

  return players;
}

// Check if tile is discovered
function isDiscovered(state: GameState, x: number, y: number): boolean {
  const level = state.currentLevel;
  if (x < 0 || x >= level.width || y < 0 || y >= level.height) return false;
  return level.discovered[y * level.width + x];
}

// Get themed name for a tile
function getTileName(
  tile: TileKind,
  tileFlavors: Partial<Record<TileKind, TileFlavor>>
): string {
  const flavor = tileFlavors[tile];
  if (flavor?.name) return flavor.name.toLowerCase();

  // Fallback to generic descriptions
  const fallbacks: Partial<Record<TileKind, string>> = {
    OpenGround: 'open ground',
    DenseGround: 'dense undergrowth',
    BareGround: 'bare ground',
    TraveledGround: 'a worn path',
    SlowGround: 'difficult terrain',
    OpenSpace: 'an open clearing',
    GroundDetail: 'decorative features',
    TallObstacle: 'a tall obstacle',
    DamagedTallObstacle: 'a damaged obstacle',
    LowObstacle: 'a low obstacle',
    SmallObstacle: 'small debris',
    LargeObstacle: 'a large obstacle',
    FallenObstacle: 'fallen debris',
    ObstacleRemnant: 'remnants',
    DeepLiquid: 'deep liquid',
    ShallowLiquid: 'shallow liquid',
    FloorBuilt: 'constructed flooring',
    WallSolid: 'a solid wall',
    WallFragile: 'a fragile wall',
    Barrier: 'a barrier',
    Portal: 'an opening',
    DoorClosed: 'a closed door',
    DoorOpen: 'an open doorway',
    ExitDown: 'a descent',
    ExitUp: 'an ascent',
    Transition: 'a passage',
  };

  return fallbacks[tile] ?? 'unknown terrain';
}

// Get themed name and color for an enemy
function getEnemyInfo(
  monster: Monster,
  enemyFlavors: Record<string, EnemyFlavor>
): { name: string; color: string } {
  const flavor = enemyFlavors[monster.templateId];
  const name = flavor?.name ?? 'an enemy';

  let color = ENTITY_COLORS.monsterCommon;
  if (monster.templateId.includes('boss')) {
    color = ENTITY_COLORS.monsterBoss;
  } else if (monster.templateId.includes('elite')) {
    color = ENTITY_COLORS.monsterElite;
  }

  return { name, color };
}

// Direction data
type DirectionName = 'North' | 'South' | 'East' | 'West';
const DIRECTIONS: { name: DirectionName; dx: number; dy: number }[] = [
  { name: 'North', dx: 0, dy: -1 },
  { name: 'South', dx: 0, dy: 1 },
  { name: 'East', dx: 1, dy: 0 },
  { name: 'West', dx: -1, dy: 0 },
];

// Scan in a direction and collect what's visible
function scanDirection(
  state: GameState,
  playerX: number,
  playerY: number,
  dx: number,
  dy: number,
  playerEntityId?: string,
  maxDist: number = 6
): { tiles: Set<string>; monsters: Monster[]; players: Player[]; blocked: boolean; atMapEdge: boolean } {
  const tiles = new Set<string>();
  let blocked = false;
  let atMapEdge = false;

  for (let dist = 1; dist <= maxDist; dist++) {
    const x = playerX + dx * dist;
    const y = playerY + dy * dist;

    const tile = getTileAt(state, x, y);
    if (!tile) {
      // We've hit the map boundary
      atMapEdge = true;
      break;
    }

    if (!isDiscovered(state, x, y)) break;

    const tileName = getTileName(tile, state.tileFlavors);
    tiles.add(tileName);

    // Check if this tile blocks further vision
    const isBlocking = tile === 'TallObstacle' || tile === 'DamagedTallObstacle' ||
                       tile === 'LowObstacle' || tile === 'LargeObstacle' ||
                       tile === 'WallSolid' || tile === 'WallFragile' || tile === 'DoorClosed';
    if (isBlocking) {
      blocked = true;
      break;
    }
  }

  // Get monsters in this direction (wider search)
  const monsters = getEntitiesInArea(state, playerX, playerY, dx, dy, maxDist);
  const players = getPlayersInArea(state, playerX, playerY, dx, dy, maxDist, playerEntityId);

  return { tiles, monsters, players, blocked, atMapEdge };
}

// Direction line component with colored enemy names
const DirectionLine: React.FC<{
  direction: DirectionName;
  tiles: string[];
  monsters: Monster[];
  players: Player[];
  blocked: boolean;
  atMapEdge: boolean;
  enemyFlavors: Record<string, EnemyFlavor>;
}> = ({ direction, tiles, monsters, players, blocked, atMapEdge, enemyFlavors }) => {
  const elements: React.ReactNode[] = [];

  // Add direction label
  elements.push(
    <Text key="dir" bold>{direction}: </Text>
  );

  const parts: React.ReactNode[] = [];

  // Add enemies first (most important) with colors
  for (let i = 0; i < monsters.length && i < 2; i++) {
    const { name, color } = getEnemyInfo(monsters[i], enemyFlavors);
    if (parts.length > 0) {
      parts.push(<Text key={`sep-e${i}`}>, </Text>);
    }
    parts.push(<Text key={`enemy-${i}`} color={color}>{name}</Text>);
  }
  if (monsters.length > 2) {
    parts.push(<Text key="more-enemies"> +{monsters.length - 2} more</Text>);
  }

  // Add visible players (exclude self) with their own colors
  for (let i = 0; i < players.length && i < 2; i++) {
    if (parts.length > 0) {
      parts.push(<Text key={`sep-p${i}`}>, </Text>);
    }
    parts.push(
      <Text key={`player-${i}`} color={players[i].tokenColor ?? ENTITY_COLORS.player}>
        {players[i].name}
      </Text>
    );
  }
  if (players.length > 2) {
    parts.push(<Text key="more-players"> +{players.length - 2} more</Text>);
  }

  // Add terrain (limit to 2, skip if we have enemies to save space)
  const maxTiles = monsters.length > 0 || players.length > 0 ? 1 : 2;
  const tileList = Array.from(tiles).slice(0, maxTiles);
  for (let i = 0; i < tileList.length; i++) {
    if (parts.length > 0) {
      parts.push(<Text key={`sep-t${i}`}>, </Text>);
    }
    parts.push(<Text key={`tile-${i}`} dimColor>{tileList[i]}</Text>);
  }

  // If nothing found
  if (parts.length === 0) {
    if (atMapEdge) {
      parts.push(<Text key="edge" color="gray">map edge</Text>);
    } else if (blocked) {
      parts.push(<Text key="blocked" dimColor>blocked</Text>);
    } else {
      parts.push(<Text key="same" dimColor>clear</Text>);
    }
  }

  elements.push(...parts);

  return (
    <Box>
      <Text wrap="truncate">{elements}</Text>
    </Box>
  );
};

export const ContextPanel: React.FC<ContextPanelProps> = ({ state, playerEntityId, width = 30 }) => {
  const player = getPlayer(state, playerEntityId);

  if (!player) {
    return (
      <Box flexDirection="column" width={width} paddingLeft={1}>
        <Text dimColor>No player found</Text>
      </Box>
    );
  }

  const { x: px, y: py } = player.position;

  // Get tile player is standing on
  const standingTile = getTileAt(state, px, py);
  const standingName = standingTile ? getTileName(standingTile, state.tileFlavors) : 'unknown';

  // Scan each direction
  const directionScans = DIRECTIONS.map(({ name, dx, dy }) => {
    const scan = scanDirection(state, px, py, dx, dy, playerEntityId ?? state.playerId);
    return {
      direction: name,
      tiles: Array.from(scan.tiles),
      monsters: scan.monsters,
      players: scan.players,
      blocked: scan.blocked,
      atMapEdge: scan.atMapEdge,
    };
  });

  // Check if standing on transition tile
  const isOnTransition = standingTile === 'Transition';

  return (
    <Box
      flexDirection="column"
      width={width}
      paddingLeft={1}
      paddingRight={1}
      borderStyle="single"
      borderColor="gray"
    >
      <Text bold color="cyan">Surroundings</Text>
      <Text dimColor> ({px}, {py})</Text>
      <Box height={1} />

      <Text>You stand on <Text color="green">{standingName}</Text>.</Text>
      {isOnTransition && (
        <Text color="yellow">Press E or &gt; to travel</Text>
      )}
      <Box height={1} />

      {directionScans.map((scan) => (
        <DirectionLine
          key={scan.direction}
          direction={scan.direction}
          tiles={scan.tiles}
          monsters={scan.monsters}
          players={scan.players}
          blocked={scan.blocked}
          atMapEdge={scan.atMapEdge}
          enemyFlavors={state.enemyFlavors}
        />
      ))}
    </Box>
  );
};

export default ContextPanel;
