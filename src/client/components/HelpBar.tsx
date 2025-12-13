/**
 * HelpBar component - Shows keyboard controls.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface HelpBarProps {
  compact?: boolean;
}

/**
 * Main HelpBar component.
 */
export const HelpBar: React.FC<HelpBarProps> = ({ compact = false }) => {
  if (compact) {
    return (
      <Box marginTop={1}>
        <Text dimColor>WASD: Move | E/&gt;: Travel (◊) | Space: Wait | /: Command | Q: Quit</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1} gap={2}>
      <Text dimColor>
        <Text color="#808080">WASD/Arrows:</Text> Move
      </Text>
      <Text dimColor>
        <Text color="#808080">E/&gt;:</Text> Travel <Text color="white">◊</Text>
      </Text>
      <Text dimColor>
        <Text color="#808080">Space:</Text> Wait
      </Text>
      <Text dimColor>
        <Text color="#808080">/:</Text> Command
      </Text>
      <Text dimColor>
        <Text color="#808080">Q:</Text> Quit
      </Text>
    </Box>
  );
};

export default HelpBar;
