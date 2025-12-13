import React, { useState, useCallback, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp, useStdout, type Key } from 'ink';
import { z } from 'zod';
import type { GameState, Action, Direction } from '../domain/model.js';
import { playerEntityId } from '../domain/ids.js';
import {
  PlayerProfilePublicSchema,
  PlayerProfileSummarySchema,
  WorldSummarySchema,
  WsServerMessageSchema,
  type PlayerProfilePublic,
  type PlayerProfileSummary,
  type WorldSummary,
} from '../protocol/ws.js';
import { GameMap, StatusPanel, MessageLog, HelpBar, ContextPanel } from './components/index.js';
import { CONFIG } from '../config/index.js';
import { loadOrCreateClientIdentity, saveClientIdentity, type ClientIdentity } from './identity.js';

const SERVER_URL = CONFIG.client.serverUrl;

type Screen = 'Corridor' | 'Loading' | 'Game' | 'GameOver';
type CorridorPhase =
  | 'init'
  | 'selectPlayer'
  | 'enterPlayerId'
  | 'enterPlayerPrompt'
  | 'selectWorld'
  | 'enterGameId'
  | 'enterTheme'
  | 'enterSeed';

function toWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

const WS_URL = toWsUrl(SERVER_URL);

function newClientRequestId(): string {
  return `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Schema for state payload (still intentionally permissive for UI)
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

const JoinResponseSchema = z.object({
  state: GameStateSchema,
});

const ListPlayersResponseSchema = z.object({
  players: z.array(PlayerProfileSummarySchema),
});

const GetPlayerProfileResponseSchema = z.object({
  player: PlayerProfilePublicSchema.optional(),
});

const CreatePlayerProfileResponseSchema = z.object({
  player: PlayerProfilePublicSchema,
});

const ListWorldsResponseSchema = z.object({
  worlds: z.array(WorldSummarySchema),
});

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
  const [identity, setIdentity] = useState<ClientIdentity | null>(null);
  const [identityIsEphemeral, setIdentityIsEphemeral] = useState(false);
  const [themePrompt, setThemePrompt] = useState('');
  const [inputBuffer, setInputBuffer] = useState('');
  const [corridorPhase, setCorridorPhase] = useState<CorridorPhase>('init');
  const [corridorBusy, setCorridorBusy] = useState(false);
  const [corridorBusyLabel, setCorridorBusyLabel] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerProfileSummary[]>([]);
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [pendingPlayerId, setPendingPlayerId] = useState<string | null>(null);
  const [gameInputMode, setGameInputMode] = useState<'normal' | 'command'>('normal');
  const [commandBuffer, setCommandBuffer] = useState('');
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef(new Map<string, {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>());
  const gameIdRef = useRef<string | null>(null);

  useEffect(() => {
    gameIdRef.current = gameId;
  }, [gameId]);

  useEffect(() => {
    loadOrCreateClientIdentity()
      .then(setIdentity)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load client identity');
      });
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setWsStatus('connecting');

    ws.onopen = () => setWsStatus('open');
    ws.onclose = () => {
      setWsStatus('closed');
      for (const pending of pendingRef.current.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('WebSocket disconnected'));
      }
      pendingRef.current.clear();
    };
    ws.onerror = () => setWsStatus('closed');

    ws.onmessage = (event) => {
      const rawText =
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data);

      let json: unknown;
      try {
        json = JSON.parse(rawText);
      } catch {
        return;
      }

      const parsed = WsServerMessageSchema.safeParse(json);
      if (!parsed.success) return;

      const msg = parsed.data;
      if (msg.type === 'response') {
        const pending = pendingRef.current.get(msg.requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pendingRef.current.delete(msg.requestId);

        if (msg.ok) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error.message));
        }
        return;
      }

      if (msg.type === 'state') {
        if (!gameIdRef.current || msg.gameId !== gameIdRef.current) return;

        const stateParsed = GameStateSchema.safeParse(msg.state);
        if (!stateParsed.success) return;

        setGameState(stateParsed.data as unknown as GameState);
        setIsTransitioning(false);
        if (msg.gameStatus === 'gameOver') {
          setScreen('GameOver');
        }
      }
    };

    return () => {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const sendWsRequest = useCallback((payload: Record<string, unknown>): Promise<unknown> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not connected'));
    }

    const requestId = newClientRequestId();
    const msg = { ...payload, requestId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error('Request timed out'));
      }, 15_000);

      pendingRef.current.set(requestId, { resolve, reject, timeout });
      ws.send(JSON.stringify(msg));
    });
  }, []);

  const refreshPlayers = useCallback(async () => {
    setCorridorBusy(true);
    setCorridorBusyLabel('Fetching known players...');
    setError(null);

    try {
      const data = await sendWsRequest({ type: 'listPlayers', limit: 20 });
      const parsed = ListPlayersResponseSchema.parse(data);
      setPlayers(parsed.players);
    } catch (err) {
      setPlayers([]);
      setError(err instanceof Error ? err.message : 'Failed to list players');
    } finally {
      setCorridorBusy(false);
      setCorridorBusyLabel(null);
    }
  }, [sendWsRequest]);

  const refreshWorlds = useCallback(
    async (playerId: string) => {
      setCorridorBusy(true);
      setCorridorBusyLabel('Fetching your worlds...');
      setError(null);

      try {
        const data = await sendWsRequest({ type: 'listWorlds', playerId, limit: 20 });
        const parsed = ListWorldsResponseSchema.parse(data);
        setWorlds(parsed.worlds);
      } catch (err) {
        setWorlds([]);
        setError(err instanceof Error ? err.message : 'Failed to list worlds');
      } finally {
        setCorridorBusy(false);
        setCorridorBusyLabel(null);
      }
    },
    [sendWsRequest]
  );

  const applyIdentity = useCallback(
    (next: ClientIdentity, opts?: { ephemeral?: boolean }) => {
      const ephemeral = opts?.ephemeral ?? false;
      setIdentityIsEphemeral(ephemeral);
      setIdentity((prev) => {
        const merged: ClientIdentity = { ...(prev ?? {}), ...next };
        const unchanged =
          prev &&
          prev.playerId === merged.playerId &&
          prev.playerName === merged.playerName &&
          prev.lastGameId === merged.lastGameId;
        if (unchanged) return prev;
        if (!ephemeral) {
          void saveClientIdentity(merged);
        }
        return merged;
      });
    },
    []
  );

  useEffect(() => {
    if (screen !== 'Corridor') return;
    if (wsStatus !== 'open') return;
    if (!identity) return;
    if (corridorPhase !== 'init') return;

    let cancelled = false;
    void (async () => {
      try {
        const data = await sendWsRequest({ type: 'getPlayerProfile', playerId: identity.playerId });
        const parsed = GetPlayerProfileResponseSchema.parse(data);
        if (parsed.player && !cancelled) {
          const updated: ClientIdentity = { ...identity, playerName: parsed.player.name };
          applyIdentity(updated, { ephemeral: identityIsEphemeral });
          await refreshWorlds(updated.playerId);
          if (!cancelled) setCorridorPhase('selectWorld');
          return;
        }
      } catch {
        // fall through to player selection
      }

      await refreshPlayers();
      if (!cancelled) setCorridorPhase('selectPlayer');
    })();

    return () => {
      cancelled = true;
    };
  }, [applyIdentity, corridorPhase, identity, identityIsEphemeral, refreshPlayers, refreshWorlds, screen, sendWsRequest, wsStatus]);

  const leaveCurrentGame = useCallback(() => {
    const currentGameId = gameIdRef.current;
    if (currentGameId) {
      void sendWsRequest({ type: 'leave', gameId: currentGameId }).catch(() => undefined);
    }
  }, [sendWsRequest]);

  const handleStartGame = useCallback(async (theme: string, gameSeed: string) => {
    if (!identity) {
      setError('Client identity not loaded yet.');
      return;
    }
    setScreen('Loading');
    setError(null);

    try {
      const data = await sendWsRequest({
        type: 'startRun',
        playerId: identity.playerId,
        playerName: identity.playerName,
        themePrompt: theme,
        seed: gameSeed || Date.now().toString(),
        difficulty: 'Normal',
        rulesVersion: '0.1.0',
      });
      const parsed = StartRunResponseSchema.parse(data);
      const state = parsed.state as unknown as GameState;
      const newGameId = parsed.gameId;
      gameIdRef.current = newGameId;
      setGameId(newGameId);
      setGameState(state);
      setThemePrompt(state.worldConfig.themePrompt);
      setScreen('Game');
      if (!identityIsEphemeral) {
        void saveClientIdentity({ ...identity, lastGameId: newGameId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
      setScreen('Corridor');
    }
  }, [identity, identityIsEphemeral, sendWsRequest]);

  const handleJoinGame = useCallback(async (existingGameId: string) => {
    if (!identity) {
      setError('Client identity not loaded yet.');
      return;
    }
    setScreen('Loading');
    setError(null);

    try {
      const data = await sendWsRequest({
        type: 'join',
        gameId: existingGameId,
        playerId: identity.playerId,
        playerName: identity.playerName,
      });
      const parsed = JoinResponseSchema.parse(data);
      const state = parsed.state as unknown as GameState;
      gameIdRef.current = existingGameId;
      setGameId(existingGameId);
      setGameState(state);
      setThemePrompt(state.worldConfig.themePrompt);
      setScreen('Game');
      if (!identityIsEphemeral) {
        void saveClientIdentity({ ...identity, lastGameId: existingGameId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
      setScreen('Corridor');
    }
  }, [identity, identityIsEphemeral, sendWsRequest]);

  const handleAction = useCallback(async (action: Action) => {
    if (!gameId || !gameState) return;
    if (!identity) return;
    if (isTransitioning) return; // Block input during transition

    try {
      if (action.kind === 'Transition') {
        setIsTransitioning(true);
      }

      await sendWsRequest({
        type: 'action',
        gameId,
        playerId: identity.playerId,
        playerName: identity.playerName,
        action,
      });
    } catch (err) {
      setIsTransitioning(false);
      setError(err instanceof Error ? err.message : 'Command failed');
    }
  }, [gameId, gameState, identity, isTransitioning, sendWsRequest]);

  const handleCorridorInput = useCallback(
    async (input: string, key: Key) => {
      if (corridorBusy) return;

      if (key.return) {
        const trimmed = inputBuffer.trim();

        if (corridorPhase === 'selectPlayer') {
          if (!trimmed) return;
          const lower = trimmed.toLowerCase();

          if (lower === 'r') {
            setInputBuffer('');
            await refreshPlayers();
            return;
          }

          if (lower === 'n') {
            const id = crypto.randomUUID();
            setPendingPlayerId(id);
            setInputBuffer('');
            setCorridorPhase('enterPlayerPrompt');
            return;
          }

          if (lower === 'i') {
            setInputBuffer('');
            setCorridorPhase('enterPlayerId');
            return;
          }

          const index = Number(trimmed);
          if (Number.isFinite(index) && index >= 1 && index <= players.length) {
            const selected = players[index - 1];
            if (!selected) return;
            applyIdentity({ playerId: selected.playerId, playerName: selected.name }, { ephemeral: false });
            setInputBuffer('');
            await refreshWorlds(selected.playerId);
            setCorridorPhase('selectWorld');
            return;
          }

          setError('Invalid selection. Enter a number, or N/I/R.');
          return;
        }

        if (corridorPhase === 'enterPlayerId') {
          setInputBuffer('');
          if (!trimmed) {
            setCorridorPhase('selectPlayer');
            return;
          }

          const parsedId = z.string().uuid().safeParse(trimmed);
          if (!parsedId.success) {
            setError('Invalid UUID.');
            return;
          }

          try {
            const data = await sendWsRequest({ type: 'getPlayerProfile', playerId: parsedId.data });
            const parsed = GetPlayerProfileResponseSchema.parse(data);
            if (parsed.player) {
              applyIdentity({ playerId: parsed.player.playerId, playerName: parsed.player.name }, { ephemeral: false });
              await refreshWorlds(parsed.player.playerId);
              setCorridorPhase('selectWorld');
              return;
            }
          } catch {
            // fall through to prompt
          }

          setPendingPlayerId(parsedId.data);
          setCorridorPhase('enterPlayerPrompt');
          return;
        }

        if (corridorPhase === 'enterPlayerPrompt') {
          if (!trimmed) return;
          setInputBuffer('');
          setCorridorBusy(true);
          setCorridorBusyLabel('Consulting the oracle...');
          setError(null);

          try {
            const data = await sendWsRequest({
              type: 'createPlayerProfile',
              playerId: pendingPlayerId ?? undefined,
              prompt: trimmed,
            });
            const parsed = CreatePlayerProfileResponseSchema.parse(data);
            const player: PlayerProfilePublic = parsed.player;
            applyIdentity({ playerId: player.playerId, playerName: player.name }, { ephemeral: identityIsEphemeral });
            setPendingPlayerId(null);
            await refreshPlayers();
            await refreshWorlds(player.playerId);
            setCorridorPhase('selectWorld');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create player profile');
          } finally {
            setCorridorBusy(false);
            setCorridorBusyLabel(null);
          }
          return;
        }

        if (corridorPhase === 'selectWorld') {
          if (!trimmed) return;
          const lower = trimmed.toLowerCase();

          if (lower === 'p') {
            setInputBuffer('');
            setError(null);
            setCorridorPhase('selectPlayer');
            await refreshPlayers();
            return;
          }

          if (lower === 'c') {
            const id = crypto.randomUUID();
            setPendingPlayerId(id);
            setInputBuffer('');
            setError(null);
            setCorridorPhase('enterPlayerPrompt');
            return;
          }

          if (lower === 'r') {
            setInputBuffer('');
            if (identity) await refreshWorlds(identity.playerId);
            return;
          }

          if (lower === 'n') {
            setThemePrompt('');
            setInputBuffer('');
            setCorridorPhase('enterTheme');
            return;
          }

          if (lower === 'g') {
            setInputBuffer('');
            setCorridorPhase('enterGameId');
            return;
          }

          const index = Number(trimmed);
          if (Number.isFinite(index) && index >= 1 && index <= worlds.length) {
            const selected = worlds[index - 1];
            if (!selected) return;
            setInputBuffer('');
            handleJoinGame(selected.gameId);
            return;
          }

          setError('Invalid selection. Enter a number, or N/G/R/P/C.');
          return;
        }

        if (corridorPhase === 'enterGameId') {
          setInputBuffer('');
          if (!trimmed) {
            setCorridorPhase('selectWorld');
            return;
          }
          handleJoinGame(trimmed);
          return;
        }

        if (corridorPhase === 'enterTheme') {
          if (!trimmed) return;
          setThemePrompt(trimmed);
          setInputBuffer('');
          setCorridorPhase('enterSeed');
          return;
        }

        if (corridorPhase === 'enterSeed') {
          handleStartGame(themePrompt, trimmed);
          setInputBuffer('');
          return;
        }

        return;
      }

      if (key.backspace || key.delete) {
        setInputBuffer((prev) => prev.slice(0, -1));
        return;
      }

      if (!key.ctrl && !key.meta && !key.escape && input) {
        setInputBuffer((prev) => prev + input);
      }
    },
    [
      applyIdentity,
      corridorBusy,
      corridorPhase,
      handleJoinGame,
      handleStartGame,
      identity,
      identityIsEphemeral,
      inputBuffer,
      pendingPlayerId,
      players,
      refreshPlayers,
      refreshWorlds,
      sendWsRequest,
      themePrompt,
      worlds,
    ]
  );

  const handleGameInput = useCallback((input: string, key: Key) => {
    if (input === '/' && !key.ctrl && !key.meta) {
      setGameInputMode('command');
      setCommandBuffer('/');
      return;
    }

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

  const handleGameCommandInput = useCallback((input: string, key: Key) => {
    if (key.escape) {
      setGameInputMode('normal');
      setCommandBuffer('');
      return;
    }

    if (key.return) {
      const text = commandBuffer.trim();
      setGameInputMode('normal');
      setCommandBuffer('');

      if (!text || text === '/') return;
      handleAction({ kind: 'Command', text });
      return;
    }

    if (key.backspace || key.delete) {
      setCommandBuffer((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
      return;
    }

    if (!key.ctrl && !key.meta && !key.escape && input) {
      setCommandBuffer((prev) => prev + input);
    }
  }, [commandBuffer, handleAction]);

  const handleGameOverInput = useCallback((_input: string, key: Key) => {
    if (key.return) {
      leaveCurrentGame();
      setScreen('Corridor');
      gameIdRef.current = null;
      setGameId(null);
      setGameState(null);
      setThemePrompt('');
      setInputBuffer('');
      setGameInputMode('normal');
      setCommandBuffer('');
      setCorridorPhase('init');
    }
  }, [leaveCurrentGame]);

  useInput((input, key) => {
    if (key.ctrl && (input === 'n' || input === 'N')) {
      if (screen !== 'Corridor') return;
      const playerId = crypto.randomUUID();
      applyIdentity({ playerId }, { ephemeral: true });
      setPendingPlayerId(playerId);
      setInputBuffer('');
      setCorridorPhase('enterPlayerPrompt');
      setError(null);
      return;
    }

    // global quit first
    if (input === 'q' || input === 'Q') {
      if (screen === 'Game' || screen === 'GameOver') {
        leaveCurrentGame();
        setScreen('Corridor');
        gameIdRef.current = null;
        setGameId(null);
        setGameState(null);
        setThemePrompt('');
        setInputBuffer('');
        setGameInputMode('normal');
        setCommandBuffer('');
        setCorridorPhase('init');
      } else {
        exit();
      }
      return;
    }

    switch (screen) {
      case 'Corridor':
        return void handleCorridorInput(input, key);
      case 'Game':
        return gameInputMode === 'command'
          ? handleGameCommandInput(input, key)
          : handleGameInput(input, key);
      case 'GameOver':
        return handleGameOverInput(input, key);
      default:
        return;
    }
  });

  // Corridor screen
  if (screen === 'Corridor') {
    const playerLines =
      players.length > 0
        ? players.slice(0, 9).map((p, idx) => (
            <Text key={p.playerId} dimColor>
              {String(idx + 1).padStart(2, ' ')}. {p.tokenChar} {p.name} ({p.playerId.slice(0, 8)}…)
            </Text>
          ))
        : [<Text key="none" dimColor>No players found on server yet.</Text>];

    const worldLines =
      worlds.length > 0
        ? worlds.slice(0, 9).map((w, idx) => (
            <Text key={w.gameId} dimColor>
              {String(idx + 1).padStart(2, ' ')}. {w.themePrompt ? w.themePrompt.slice(0, 40) : '(unknown theme)'} ({w.gameId.slice(-8)})
            </Text>
          ))
        : [<Text key="none" dimColor>No worlds found for this player.</Text>];

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

        {identity && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              Player: {identity.playerName ? `${identity.playerName} (${identity.playerId})` : identity.playerId}
            </Text>
            {identityIsEphemeral && <Text dimColor>Identity: ephemeral (won’t be saved)</Text>}
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          {corridorPhase === 'init' && (
            <>
              <Text dimColor>Connecting to server…</Text>
              <Text dimColor>WebSocket: {wsStatus === 'open' ? 'connected' : wsStatus}</Text>
            </>
          )}

          {corridorPhase === 'selectPlayer' && (
            <>
              <Text>Select a player:</Text>
              <Box marginTop={1} flexDirection="column">
                {playerLines}
              </Box>
              <Box marginTop={1} flexDirection="column">
                <Text dimColor>N: New player</Text>
                <Text dimColor>I: Enter playerId</Text>
                <Text dimColor>R: Refresh list</Text>
              </Box>
            </>
          )}

          {corridorPhase === 'enterPlayerId' && (
            <>
              <Text>Enter a playerId (UUID) to use (or press Enter to cancel):</Text>
            </>
          )}

          {corridorPhase === 'enterPlayerPrompt' && (
            <>
              <Text>Describe your character (the oracle will pick name/description/token):</Text>
              {pendingPlayerId && <Text dimColor>playerId: {pendingPlayerId}</Text>}
            </>
          )}

          {corridorPhase === 'selectWorld' && (
            <>
              <Text>Select a world to rejoin:</Text>
              <Box marginTop={1} flexDirection="column">
                {worldLines}
              </Box>
              <Box marginTop={1} flexDirection="column">
                <Text dimColor>N: Start a new world</Text>
                <Text dimColor>G: Join by gameId</Text>
                <Text dimColor>R: Refresh list</Text>
                <Text dimColor>P: Change player</Text>
                <Text dimColor>C: Create new player</Text>
              </Box>
            </>
          )}

          {corridorPhase === 'enterGameId' && (
            <>
              <Text>Enter a gameId to join (or press Enter to cancel):</Text>
            </>
          )}

          {corridorPhase === 'enterTheme' && (
            <>
              <Text>Describe the universe you wish to explore:</Text>
            </>
          )}

          {corridorPhase === 'enterSeed' && (
            <>
              <Text>Enter a seed (or press Enter for random):</Text>
              <Text dimColor>Theme: "{themePrompt}"</Text>
            </>
          )}
        </Box>

        <Box marginTop={1}>
          <Text color="cyan">&gt; {inputBuffer}</Text>
          <Text color="gray">_</Text>
        </Box>

        {corridorBusy && corridorBusyLabel && (
          <Box marginTop={1}>
            <Text dimColor>{corridorBusyLabel}</Text>
          </Box>
        )}

        {error && (
          <Box marginTop={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}

        <Box marginTop={2}>
          <Text dimColor>WebSocket: {wsStatus === 'open' ? 'connected' : wsStatus}</Text>
          <Text dimColor>Ctrl+N: new player identity</Text>
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
    const localPlayerEntityId = identity ? playerEntityId(identity.playerId) : undefined;

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="#00ced1">
          {gameState.worldConfig.themePrompt.slice(0, Math.min(80, terminalSize.width - 4))}
          {gameState.worldConfig.themePrompt.length > 80 ? '...' : ''}
        </Text>
        <Text dimColor>Game ID: {gameId ?? 'unknown'}</Text>
        {identity && (
          <Text dimColor>
            Player: {identity.playerName ? `${identity.playerName} (${identity.playerId})` : identity.playerId}
          </Text>
        )}

        <Box flexDirection="row">
          <GameMap
            state={gameState}
            enemyFlavors={gameState.enemyFlavors}
            tileFlavors={gameState.tileFlavors}
            playerEntityId={localPlayerEntityId}
            viewWidth={mapWidth}
            viewHeight={viewHeight}
          />
          <ContextPanel
            state={gameState}
            playerEntityId={localPlayerEntityId}
            width={contextPanelWidth}
          />
        </Box>
        <StatusPanel state={gameState} playerEntityId={localPlayerEntityId} />
        <MessageLog state={gameState} />
        {gameInputMode === 'command' && !isTransitioning && (
          <Box marginTop={1}>
            <Text color="cyan">{commandBuffer}</Text>
            <Text dimColor>_</Text>
            <Text dimColor> (Enter to send, Esc to cancel)</Text>
          </Box>
        )}
        {isTransitioning ? (
          <Box borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1}>
            <Text bold color="cyan">Traveling to a new area... </Text>
            <Text dimColor>Generating world...</Text>
          </Box>
        ) : gameInputMode === 'command' ? null : (
          <HelpBar />
        )}
      </Box>
    );
  }

  return <Text>Loading...</Text>;
};

render(<App />);
