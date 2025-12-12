/**
 * MessageLog component - Displays recent game messages.
 * Color-coded by message type with dimmed older messages.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { GameState, GameMessageKind } from '../../domain/model.js';

interface MessageLogProps {
  state: GameState;
  maxMessages?: number;
}

/**
 * Get color for message based on kind.
 */
function getMessageColor(kind: GameMessageKind): string {
  switch (kind) {
    case 'combat':
      return '#ff4444'; // Red
    case 'flavor':
      return '#00ced1'; // Cyan
    case 'system':
      return '#ffd700'; // Gold
    default:
      return '#ffffff'; // White
  }
}

/**
 * Main MessageLog component.
 */
export const MessageLog: React.FC<MessageLogProps> = ({ state, maxMessages = 5 }) => {
  const recentMessages = state.messages.slice(-maxMessages);

  if (recentMessages.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>No messages yet...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {recentMessages.map((msg, i) => {
        const isOld = i < recentMessages.length - 2;
        const color = getMessageColor(msg.kind);

        return (
          <Text key={i} color={color} dimColor={isOld}>
            {msg.text}
          </Text>
        );
      })}
    </Box>
  );
};

export default MessageLog;
