/**
 * GameMap component - Renders the dungeon map with proper tile colors.
 *
 * Uses the TILE_DATA registry for character and color lookups.
 * Supports truecolor hex colors for rich visuals.
 * Can use AI-provided tileFlavors for themed rendering.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { GameState, EnemyFlavor, TileFlavor, TileKind } from '../../domain/model.js';
import { getTileChar, getTileFg, getTileBg, ENTITY_COLORS, UNDISCOVERED_COLOR } from '../../domain/tiles.js';

interface GameMapProps {
  state: GameState;
  enemyFlavors: Record<string, EnemyFlavor>;
  tileFlavors?: Partial<Record<TileKind, TileFlavor>>;
  playerEntityId?: string;
  viewWidth: number;
  viewHeight: number;
}

// Get player from state
function getPlayer(state: GameState, playerEntityId?: string) {
  const id = playerEntityId ?? state.playerId;
  const entity = state.currentLevel.entities.find((e) => e.id === id);
  return entity?.kind === 'Player' ? entity : undefined;
}

// Cell data for rendering
interface CellData {
  char: string;
  fg: string;
  bg?: string;
}

/**
 * Get render data for a single cell at (x, y).
 * Uses tileFlavors for AI-themed rendering if available.
 */
function getCellData(
  state: GameState,
  x: number,
  y: number,
  enemyFlavors: Record<string, EnemyFlavor>,
  tileFlavors?: Partial<Record<TileKind, TileFlavor>>
): CellData {
  const level = state.currentLevel;
  const idx = y * level.width + x;
  const discovered = level.discovered[idx];

  // Undiscovered tiles are dark
  if (!discovered) {
    return { char: ' ', fg: UNDISCOVERED_COLOR };
  }

  // Check for entity at this position
  const entity = level.entities.find((e) => e.position.x === x && e.position.y === y);

  if (entity) {
    if (entity.kind === 'Player') {
      return { char: entity.tokenChar || '@', fg: entity.tokenColor ?? ENTITY_COLORS.player };
    }

    if (entity.kind === 'Monster') {
      // Determine monster display based on template
      const flavor = enemyFlavors[entity.templateId];
      let char = 'm';
      let color = ENTITY_COLORS.monsterCommon;

      if (entity.templateId.includes('boss') || flavor?.name.toLowerCase().includes('boss')) {
        char = 'B';
        color = ENTITY_COLORS.monsterBoss;
      } else if (entity.templateId.includes('elite')) {
        char = 'E';
        color = ENTITY_COLORS.monsterElite;
      }

      return { char, fg: color };
    }

    if (entity.kind === 'Item') {
      return { char: '!', fg: ENTITY_COLORS.item };
    }
  }

  // No entity - render tile with AI-provided flavor if available
  const tile = level.tiles[idx];

  // Check if we have AI-provided flavor for this tile type
  const flavor = tileFlavors?.[tile];
  if (flavor) {
    return {
      char: flavor.char,
      fg: flavor.fg,
      bg: flavor.bg,
    };
  }

  // Fall back to default tile rendering
  return {
    char: getTileChar(tile, x, y),
    fg: getTileFg(tile),
    bg: getTileBg(tile),
  };
}

/**
 * Render a single row of cells with proper colors.
 * Groups consecutive cells with the same colors for efficiency.
 */
const MapRow: React.FC<{ cells: CellData[] }> = ({ cells }) => {
  // Group consecutive cells with same fg/bg for efficiency
  const groups: { chars: string; fg: string; bg?: string }[] = [];

  for (const cell of cells) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.fg === cell.fg && lastGroup.bg === cell.bg) {
      lastGroup.chars += cell.char;
    } else {
      groups.push({ chars: cell.char, fg: cell.fg, bg: cell.bg });
    }
  }

  return (
    <Box>
      {groups.map((group, i) => (
        <Text key={i} color={group.fg} backgroundColor={group.bg}>
          {group.chars}
        </Text>
      ))}
    </Box>
  );
};

/**
 * Main GameMap component.
 * Renders a viewport centered on the player.
 */
export const GameMap: React.FC<GameMapProps> = ({ state, enemyFlavors, tileFlavors, playerEntityId, viewWidth, viewHeight }) => {
  const level = state.currentLevel;
  const player = getPlayer(state, playerEntityId);

  // Calculate viewport centered on player
  const centerX = player?.position.x ?? Math.floor(level.width / 2);
  const centerY = player?.position.y ?? Math.floor(level.height / 2);

  // Clamp to level bounds
  const effectiveViewWidth = Math.min(viewWidth, level.width);
  const effectiveViewHeight = Math.min(viewHeight, level.height);

  const startX = Math.max(0, Math.min(centerX - Math.floor(effectiveViewWidth / 2), level.width - effectiveViewWidth));
  const startY = Math.max(0, Math.min(centerY - Math.floor(effectiveViewHeight / 2), level.height - effectiveViewHeight));

  // Build rows of cell data
  const rows: CellData[][] = [];

  for (let y = startY; y < startY + effectiveViewHeight && y < level.height; y++) {
    const row: CellData[] = [];
    for (let x = startX; x < startX + effectiveViewWidth && x < level.width; x++) {
      row.push(getCellData(state, x, y, enemyFlavors, tileFlavors));
    }
    rows.push(row);
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <MapRow key={i} cells={row} />
      ))}
    </Box>
  );
};

export default GameMap;
