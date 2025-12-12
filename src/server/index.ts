import { createInitialGameState, applyAction, getPlayer, handleTransition } from '../engine/game.js';
import { getTemplatesForMonsters } from '../engine/templates.js';
import { getUniqueTileTypes } from '../engine/levelgen.js';
import { createAnthropicAdapter, createMockAdapter } from '../ai/anthropicAdapter.js';
import { createOpenRouterAdapter } from '../ai/openRouterAdapter.js';
import type { AIAdapter, RoomFlavorRequest } from '../ai/contracts.js';
import { consoleLogger } from '../utils/logger.js';
import type { Action, GameState, WorldConfig, Monster } from '../domain/model.js';
import { upsertEdges, upsertLevelState, upsertWorld, getWorldState } from '../db/worldRepo.js';
import { serializeGameState } from '../db/serialization.js';
import { z } from 'zod';

// ---- Logging ----

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(category: string, message: string, data?: unknown): void {
  const prefix = `[${timestamp()}] [${category}]`;
  if (data !== undefined) {
    console.log(prefix, message, JSON.stringify(data, null, 2));
  } else {
    console.log(prefix, message);
  }
}

// In-memory store of game states
const games = new Map<string, GameState>();

// AI adapter selection: Anthropic > OpenRouter > Mock
// Prefer Anthropic for reliability and speed
function createAiAdapter(): { adapter: AIAdapter; name: string } {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      adapter: createAnthropicAdapter({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL,
        logger: consoleLogger,
      }),
      name: 'Anthropic Claude',
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    return {
      adapter: createOpenRouterAdapter({
        apiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL,
        logger: consoleLogger,
      }),
      name: 'OpenRouter',
    };
  }

  return {
    adapter: createMockAdapter(),
    name: 'Mock',
  };
}

const { adapter: aiAdapter, name: aiAdapterName } = createAiAdapter();

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function newGameId(): string {
  return `game-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function persistGameState(gameId: string, state: GameState): Promise<void> {
  await upsertWorld({
    id: gameId,
    themePrompt: state.worldConfig.themePrompt,
    seed: state.worldConfig.seed,
    difficulty: state.worldConfig.difficulty,
    stateJson: serializeGameState(state),
  });

  const levelPromises = Object.values(state.world.levels).map((stored) =>
    upsertLevelState(gameId, stored.coord, stored.level, {
      tileFlavors: stored.tileFlavors,
      enemyFlavors: stored.enemyFlavors,
      roomDescription: stored.roomDescription,
    })
  );

  const edgePromise = upsertEdges(gameId, state.world.edges);
  await Promise.all([...levelPromises, edgePromise]);
}

async function loadGameState(gameId: string): Promise<GameState | null> {
  const state = await getWorldState(gameId);
  if (state) {
    games.set(gameId, state);
    return state;
  }
  return null;
}

// Generate AI flavor for the current room
async function generateRoomFlavor(state: GameState): Promise<GameState> {
  const level = state.currentLevel;
  const monsters = level.entities.filter((e): e is Monster => e.kind === 'Monster');
  const templateIds = monsters.map((m) => m.templateId);
  const templates = getTemplatesForMonsters(templateIds);

  // Get unique tile types present in the level
  const tileTypesPresent = getUniqueTileTypes(level.tiles);

  // Skip if we already have all the flavor we need
  const needsEnemyFlavor = templates.some((t) => !state.enemyFlavors[t.id]);
  const needsTileFlavor = tileTypesPresent.some((t) => !state.tileFlavors[t]);
  if (!needsEnemyFlavor && !needsTileFlavor && state.roomDescription) {
    log('AI', 'Skipping flavor generation (already have flavor)');
    return state;
  }

  const request: RoomFlavorRequest = {
    context: {
      worldConfig: state.worldConfig,
    },
    level: {
      depth: level.depth,
      width: level.width,
      height: level.height,
    },
    enemyTemplates: templates,
    tileTypesPresent,
  };

  log('AI', 'Requesting room flavor', {
    theme: state.worldConfig.themePrompt.slice(0, 50),
    depth: level.depth,
    enemyCount: templates.length,
    templateIds: templates.map((t) => t.id),
    tileTypes: tileTypesPresent,
  });

  const startTime = Date.now();

  try {
    const response = await aiAdapter.generateRoomFlavor(request);
    const elapsed = Date.now() - startTime;

    log('AI', `Response received (${elapsed}ms)`, {
      roomDescription: response.roomDescription,
      enemyFlavors: Object.keys(response.enemyFlavors).map((id) => ({
        id,
        name: response.enemyFlavors[id].name,
      })),
      tileFlavors: Object.keys(response.tileFlavors).map((kind) => ({
        kind,
        name: response.tileFlavors[kind as keyof typeof response.tileFlavors]?.name,
      })),
    });

    return {
      ...state,
      roomDescription: response.roomDescription,
      enemyFlavors: { ...state.enemyFlavors, ...response.enemyFlavors },
      tileFlavors: { ...state.tileFlavors, ...response.tileFlavors },
      world: {
        ...state.world,
        levels: {
          ...state.world.levels,
          [state.world.currentLevelId]: {
            ...state.world.levels[state.world.currentLevelId],
            enemyFlavors: { ...state.enemyFlavors, ...response.enemyFlavors },
            tileFlavors: { ...state.tileFlavors, ...response.tileFlavors },
            roomDescription: response.roomDescription,
          },
        },
      },
      messages: [
        ...state.messages,
        { turn: state.turn, text: response.roomDescription, kind: 'flavor' as const },
      ],
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    log('AI', `ERROR (${elapsed}ms): ${error instanceof Error ? error.message : String(error)}`);
    return state;
  }
}

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // CORS headers for local dev
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check
    if (req.method === 'GET' && url.pathname === '/api/health') {
      log('HTTP', 'GET /api/health');
      return jsonResponse({
        status: 'ok',
        aiAdapter: aiAdapterName,
        hasAiKey: !!(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY),
      });
    }

    // Start a new run
    if (req.method === 'POST' && url.pathname === '/api/start-run') {
      const StartRunBody = z.object({
        themePrompt: z.string(),
        seed: z.string(),
        difficulty: z.enum(['Easy', 'Normal', 'Hard']).optional(),
        rulesVersion: z.string().optional(),
      });

      const config = StartRunBody.parse(await req.json()) as WorldConfig;
      log('HTTP', 'POST /api/start-run', {
        theme: config.themePrompt?.slice(0, 50),
        seed: config.seed,
        difficulty: config.difficulty,
      });

      // Validate config
      if (!config.themePrompt || !config.seed) {
        log('HTTP', 'ERROR: Missing themePrompt or seed');
        return jsonResponse({ error: 'Missing themePrompt or seed' }, { status: 400 });
      }

      log('DEBUG', 'Creating initial game state...');
      let state: GameState;
      try {
        state = createInitialGameState({
          ...config,
          difficulty: config.difficulty || 'Normal',
          rulesVersion: config.rulesVersion || '0.1.0',
        });
        log('DEBUG', 'Game state created successfully');
      } catch (err) {
        log('DEBUG', `ERROR creating game state: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }

      const gameId = newGameId();
      log('HTTP', `Created game ${gameId}`, {
        levelSize: `${state.currentLevel.width}x${state.currentLevel.height}`,
        entityCount: state.currentLevel.entities.length,
      });

      // Generate AI flavor for the starting room
      state = await generateRoomFlavor(state);

      games.set(gameId, state);
      await persistGameState(gameId, state);
      log('HTTP', `Game ${gameId} ready`);
      return jsonResponse({ gameId, state }, { headers: corsHeaders });
    }

    // Execute a command
    if (req.method === 'POST' && url.pathname === '/api/command') {
      const ActionSchema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('Move'), direction: z.enum(['Up', 'Down', 'Left', 'Right']) }),
        z.object({ kind: z.literal('Wait') }),
        z.object({ kind: z.literal('Attack'), direction: z.enum(['Up', 'Down', 'Left', 'Right']) }),
        z.object({ kind: z.literal('Transition') }),
      ]);

      const CommandBody = z.object({
        gameId: z.string(),
        action: ActionSchema,
      });

      const body = CommandBody.parse(await req.json()) as {
        gameId: string;
        action: Action;
      };

      let state = games.get(body.gameId);
      if (!state) {
        state = await loadGameState(body.gameId) ?? undefined;
      }
      if (!state) {
        log('HTTP', 'ERROR: Game not found');
        return jsonResponse({ error: 'Game not found' }, { status: 404, headers: corsHeaders });
      }

      const player = getPlayer(state);
      log('HTTP', 'POST /api/command', {
        gameId: body.gameId.slice(-8),
        action: body.action,
        playerPos: player ? `(${player.position.x},${player.position.y})` : 'unknown',
      });
      if (!player) {
        log('HTTP', 'ERROR: Player not found');
        return jsonResponse({ error: 'Player not found' }, { status: 400, headers: corsHeaders });
      }

      let newState: GameState;

      // Handle Transition action specially to generate AI flavor for new levels
      if (body.action.kind === 'Transition') {
        const result = handleTransition(state);
        newState = result.state;

        // If we entered a new level, generate AI flavor
        if (result.isNewLevel && result.newLevelId) {
          log('LEVEL', `Player transitioned to new level: ${result.newLevelId}`);
          newState = await generateRoomFlavor(newState);
        } else if (result.isNewLevel === false && state.world?.currentLevelId !== newState.world?.currentLevelId) {
          log('LEVEL', `Player returned to existing level: ${newState.world?.currentLevelId}`);
        }
      } else {
        newState = applyAction(state, player.id, body.action);
      }

      games.set(body.gameId, newState);
      await persistGameState(body.gameId, newState);

      // Log movement result
      const newPlayer = getPlayer(newState);
      if (body.action.kind === 'Move' && newPlayer) {
        const moved = newPlayer.position.x !== player.position.x || newPlayer.position.y !== player.position.y;
        log('MOVE', moved
          ? `Moved to (${newPlayer.position.x},${newPlayer.position.y})`
          : `Blocked at (${player.position.x},${player.position.y}) trying to move ${body.action.direction}`);
      }

      // Log combat events
      if (newPlayer && newPlayer.hp !== player.hp) {
        log('COMBAT', `Player HP: ${player.hp} -> ${newPlayer.hp}`);
      }

      const oldEntityCount = state.currentLevel.entities.length;
      const newEntityCount = newState.currentLevel.entities.length;
      if (newEntityCount < oldEntityCount) {
        log('COMBAT', `Entity died (${oldEntityCount} -> ${newEntityCount} entities)`);
      }

      // Log new messages from this turn
      const newMessages = newState.messages.slice(state.messages.length);
      for (const msg of newMessages) {
        if (msg.kind === 'combat') {
          log('COMBAT', msg.text);
        }
      }

      // Server determines game status
      const gameStatus = !newPlayer || newPlayer.hp <= 0 ? 'gameOver' : 'active';
      if (gameStatus === 'gameOver') {
        log('GAME', 'Player died - game over');
      }

      return jsonResponse({ state: newState, gameStatus }, { headers: corsHeaders });
    }

    // Get current state
    if (req.method === 'GET' && url.pathname.startsWith('/api/game/')) {
      const gameId = url.pathname.replace('/api/game/', '');
      log('HTTP', `GET /api/game/${gameId.slice(-8)}`);

      let state = games.get(gameId);
      if (!state) {
        state = await loadGameState(gameId) ?? undefined;
      }

      if (!state) {
        log('HTTP', 'ERROR: Game not found');
        return jsonResponse({ error: 'Game not found' }, { status: 404, headers: corsHeaders });
      }

      return jsonResponse({ state }, { headers: corsHeaders });
    }

    log('HTTP', `404 ${req.method} ${url.pathname}`);
    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
});

console.log(`Server running on http://localhost:${server.port}`);
console.log(`AI adapter: ${aiAdapterName}`);

// Handle graceful shutdown
function shutdown() {
  console.log('\nShutting down server...');
  server.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
