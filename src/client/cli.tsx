import React, { useState, useCallback, useEffect } from 'react';
import { render, Box, Text, useInput, useApp, useStdout, type Key } from 'ink';
import { z } from 'zod';
import type { GameState, Action, Direction } from '../domain/model.js';
import { GameMap, StatusPanel, MessageLog, HelpBar, ContextPanel } from './components/index.js';
import { CONFIG } from '../config/index.js';

const SERVER_URL = CONFIG.client.serverUrl;

type Screen = 'Corridor' | 'Loading' | 'Game' | 'GameOver';

// API schemas
const GameStateSchema = z.object({
  world: z.record(z.any()),
  currentLevel: z.record(z.any()),
  worldConfig: z.object({
    themePrompt: z.string(),
    seed: z.string(),
    difficulty: z.string(),
    rulesVersion: z.string(),
  }).passthrough(),
}).passthrough();

const StartRunResponseSchema = z.object({
  gameId: z.string(),
  state: GameStateSchema,
});

const CommandResponseSchema = z.object({
  state: GameStateSchema,
  gameStatus: z.union([z.literal('active'), z.literal('gameOver')]),
});

// API functions
async function startRun(themePrompt: string, seed: string): Promise<{ gameId: string; state: GameState }> {
  const res = await fetch(`${SERVER_URL}/api/start-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      themePrompt,
      seed,
      difficulty: 'Normal',
      rulesVersion: '0.1.0',
    }),
  });
  if (!res.ok) throw new Error(`Failed to start run: ${res.statusText}`);
  const parsed = StartRunResponseSchema.parse(await res.json());
  return parsed as unknown as { gameId: string; state: GameState };
}

type GameStatus = 'active' | 'gameOver';

async function sendCommand(gameId: string, action: Action): Promise<{ state: GameState; gameStatus: GameStatus }> {
  const res = await fetch(`${SERVER_URL}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, action }),
  });
  if (!res.ok) throw new Error(`Command failed: ${res.statusText}`);
  const parsed = CommandResponseSchema.parse(await res.json());
  return parsed as unknown as { state: GameState; gameStatus: GameStatus };
}

// Hook to get terminal dimensions
function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    width: stdout?.columns ?? CONFIG.viewport.minWidth,
    height: stdout?.rows ?? CONFIG.viewport.minHeight,
  });

  useEffect(() => {
    if (!stdout) return;

    const handleResize = () => {
      setSize({
        width: stdout.columns,
        height: stdout.rows,
      });
    };

    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  return size;
}

// Main app
const App: React.FC = () => {
  const { exit } = useApp();
  const terminalSize = useTerminalSize();
  const [screen, setScreen] = useState<Screen>('Corridor');
  const [themePrompt, setThemePrompt] = useState('');
  const [inputBuffer, setInputBuffer] = useState('');
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'theme' | 'seed'>('theme');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleStartGame = useCallback(async (theme: string, gameSeed: string) => {
    setScreen('Loading');
    setError(null);

    try {
      const { gameId: newGameId, state } = await startRun(theme, gameSeed || Date.now().toString());
      setGameId(newGameId);
      setGameState(state);
      setScreen('Game');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
      setScreen('Corridor');
    }
  }, []);

  const handleAction = useCallback(async (action: Action) => {
    if (!gameId || !gameState) return;
    if (isTransitioning) return; // Block input during transition

    try {
      if (action.kind === 'Transition') {
        setIsTransitioning(true);
      }

      const { state, gameStatus } = await sendCommand(gameId, action);
      setGameState(state);
      setIsTransitioning(false);

      if (gameStatus === 'gameOver') {
        setScreen('GameOver');
      }
    } catch (err) {
      setIsTransitioning(false);
      setError(err instanceof Error ? err.message : 'Command failed');
    }
  }, [gameId, gameState, isTransitioning]);

  const handleCorridorInput = useCallback((input: string, key: Key) => {
    if (key.return) {
      if (inputMode === 'theme' && inputBuffer.trim()) {
        setThemePrompt(inputBuffer.trim());
        setInputBuffer('');
        setInputMode('seed');
      } else if (inputMode === 'seed') {
        handleStartGame(themePrompt, inputBuffer.trim());
        setInputBuffer('');
      }
    } else if (key.backspace || key.delete) {
      setInputBuffer((prev) => prev.slice(0, -1));
    } else if (!key.ctrl && !key.meta && !key.escape && input) {
      setInputBuffer((prev) => prev + input);
    }
  }, [handleStartGame, inputBuffer, inputMode, themePrompt]);

  const handleGameInput = useCallback((input: string, key: Key) => {
    let action: Action | null = null;
    let direction: Direction | null = null;

    if (input === 'w' || key.upArrow) direction = 'Up';
    else if (input === 's' || key.downArrow) direction = 'Down';
    else if (input === 'a' || key.leftArrow) direction = 'Left';
    else if (input === 'd' || key.rightArrow) direction = 'Right';
    else if (input === ' ' || input === '.') action = { kind: 'Wait' };
    else if (input === '>' || input === 'e' || input === 'E') action = { kind: 'Transition' };

    if (direction) {
      action = { kind: 'Move', direction };
    }

    if (action) {
      handleAction(action);
    }
  }, [handleAction]);

  const handleGameOverInput = useCallback((_input: string, key: Key) => {
    if (key.return) {
      setScreen('Corridor');
      setGameId(null);
      setGameState(null);
      setThemePrompt('');
      setInputMode('theme');
    }
  }, []);

  useInput((input, key) => {
    // global quit first
    if (input === 'q' || input === 'Q') {
      if (screen === 'Game' || screen === 'GameOver') {
        setScreen('Corridor');
        setGameId(null);
        setGameState(null);
        setThemePrompt('');
        setInputMode('theme');
        setInputBuffer('');
      } else {
        exit();
      }
      return;
    }

    switch (screen) {
      case 'Corridor':
        return handleCorridorInput(input, key);
      case 'Game':
        return handleGameInput(input, key);
      case 'GameOver':
        return handleGameOverInput(input, key);
      default:
        return;
    }
  });

  // Corridor screen
  if (screen === 'Corridor') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="magenta">
          ═══════════════════════════════════════
        </Text>
        <Text bold color="cyan">
          {'       '}INFINITE CORRIDOR
        </Text>
        <Text bold color="magenta">
          ═══════════════════════════════════════
        </Text>

        <Box marginTop={1}>
          <Text>
            {inputMode === 'theme'
              ? 'Describe the universe you wish to explore:'
              : 'Enter a seed (or press Enter for random):'}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color="cyan">&gt; {inputBuffer}</Text>
          <Text color="gray">_</Text>
        </Box>

        {inputMode === 'seed' && (
          <Box marginTop={1}>
            <Text dimColor>Theme: "{themePrompt}"</Text>
          </Box>
        )}

        {error && (
          <Box marginTop={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}

        <Box marginTop={2}>
          <Text dimColor>Press Q to quit</Text>
        </Box>
      </Box>
    );
  }

  // Loading screen
  if (screen === 'Loading') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Opening a portal to "{themePrompt}"...</Text>
        <Text dimColor>Generating world...</Text>
      </Box>
    );
  }

  // Game over screen
  if (screen === 'GameOver') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="red">
          ═══════════════════════════════════════
        </Text>
        <Text bold color="red">
          {'         '}YOU HAVE FALLEN
        </Text>
        <Text bold color="red">
          ═══════════════════════════════════════
        </Text>

        {gameState && (
          <Box marginTop={1} flexDirection="column">
            <Text>Turns survived: {gameState.turn}</Text>
            <Text>Depth reached: {gameState.currentLevel.depth}</Text>
          </Box>
        )}

        <Box marginTop={2}>
          <Text dimColor>Press Enter to return to the Corridor, Q to quit</Text>
        </Box>
      </Box>
    );
  }

  // Game screen
  if (screen === 'Game' && gameState) {
    const contextPanelWidth = 32;
    const mapWidth = Math.max(40, terminalSize.width - contextPanelWidth - 6);
    const viewHeight = Math.max(10, terminalSize.height - CONFIG.viewport.uiChromeHeight - 2);

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="#00ced1">
          {gameState.worldConfig.themePrompt.slice(0, Math.min(80, terminalSize.width - 4))}
          {gameState.worldConfig.themePrompt.length > 80 ? '...' : ''}
        </Text>

        <Box flexDirection="row">
          <GameMap
            state={gameState}
            enemyFlavors={gameState.enemyFlavors}
            tileFlavors={gameState.tileFlavors}
            viewWidth={mapWidth}
            viewHeight={viewHeight}
          />
          <ContextPanel
            state={gameState}
            width={contextPanelWidth}
          />
        </Box>
        <StatusPanel state={gameState} />
        <MessageLog state={gameState} />
        {isTransitioning ? (
          <Box borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1}>
            <Text bold color="cyan">Traveling to a new area... </Text>
            <Text dimColor>Generating world...</Text>
          </Box>
        ) : (
          <HelpBar />
        )}
      </Box>
    );
  }

  return <Text>Loading...</Text>;
};

render(<App />);
