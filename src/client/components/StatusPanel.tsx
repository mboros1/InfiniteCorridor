/**
 * StatusPanel component - Displays player stats and game info.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { GameState, Player } from '../../domain/model.js';

interface StatusPanelProps {
  state: GameState;
  playerEntityId?: string;
}

// Get player from state
function getPlayer(state: GameState, playerEntityId?: string): Player | undefined {
  const id = playerEntityId ?? state.playerId;
  const entity = state.currentLevel.entities.find((e) => e.id === id);
  return entity?.kind === 'Player' ? entity : undefined;
}

/**
 * Get HP bar color based on percentage.
 */
function getHpColor(hp: number, maxHp: number): string {
  const percent = hp / maxHp;
  if (percent > 0.6) return '#00ff00'; // Green
  if (percent > 0.3) return '#ffff00'; // Yellow
  return '#ff0000'; // Red
}

/**
 * Render an ASCII HP bar.
 */
const HpBar: React.FC<{ hp: number; maxHp: number; width?: number }> = ({ hp, maxHp, width = 20 }) => {
  const filled = Math.round((hp / maxHp) * width);
  const empty = width - filled;
  const color = getHpColor(hp, maxHp);

  return (
    <Text>
      HP [
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text color="#404040">{'░'.repeat(empty)}</Text>
      ] <Text color={color}>{hp}/{maxHp}</Text>
    </Text>
  );
};

/**
 * Main StatusPanel component.
 */
export const StatusPanel: React.FC<StatusPanelProps> = ({ state, playerEntityId }) => {
  const player = getPlayer(state, playerEntityId);
  if (!player) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={2}>
        <Text>Lv: <Text color="#ffd700">{player.level}</Text></Text>
        <Text color="#808080">|</Text>
        <HpBar hp={player.hp} maxHp={player.maxHp} width={15} />
        <Text color="#808080">|</Text>
        <Text>XP: <Text color="#daa520">{player.xp}</Text>/<Text color="#808080">{player.xpToNext}</Text></Text>
      </Box>
      <Box gap={2}>
        <Text>STR: <Text color="#ff6347">{player.strength}</Text></Text>
        <Text>AGI: <Text color="#98fb98">{player.agility}</Text></Text>
        <Text>INT: <Text color="#87ceeb">{player.intellect}</Text></Text>
        <Text color="#808080">|</Text>
        <Text>Turn: <Text color="#00ced1">{state.turn}</Text></Text>
        <Text>Depth: <Text color="#00ced1">{state.currentLevel.depth}</Text></Text>
      </Box>
    </Box>
  );
};

export default StatusPanel;
