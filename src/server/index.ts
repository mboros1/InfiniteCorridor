import { createInitialGameState, applyAction, getPlayer, handleTransition } from '../engine/game.js';
import { getTemplatesForMonsters } from '../engine/templates.js';
import { getUniqueTileTypes } from '../engine/levelgen.js';
import { createAnthropicAdapter, createMockAdapter } from '../ai/anthropicAdapter.js';
import { createOpenRouterAdapter } from '../ai/openRouterAdapter.js';
import type { AIAdapter, RoomFlavorRequest } from '../ai/contracts.js';
import { consoleLogger } from '../utils/logger.js';
import type { GameState, WorldConfig, Monster } from '../domain/model.js';
import { upsertEdges, upsertLevelState, upsertWorld, getWorldState } from '../db/worldRepo.js';
import { serializeGameState } from '../db/serialization.js';
import { APP_ERROR_CODE, appError, toAppError, type AppError } from '../errors/appError.js';
import { RUNTIME_CONFIG } from '../config/runtime.js';
import { E, O, TE, pipe } from '../utils/fp.js';
import { applyCommand } from './commands.js';
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

function mergeHeaders(...headersList: Array<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const headers of headersList) {
    if (!headers) continue;
    new Headers(headers).forEach((value, key) => merged.set(key, value));
  }
  return merged;
}

// In-memory store of game states
const games = new Map<string, GameState>();

// AI adapter selection: Anthropic > OpenRouter > Mock
// Prefer Anthropic for reliability and speed
function createAiAdapter(): { adapter: AIAdapter; name: string } {
  if (RUNTIME_CONFIG.anthropicApiKey) {
    return {
      adapter: createAnthropicAdapter({
        apiKey: RUNTIME_CONFIG.anthropicApiKey,
        model: RUNTIME_CONFIG.anthropicModel,
        logger: consoleLogger,
      }),
      name: 'Anthropic Claude',
    };
  }

  if (RUNTIME_CONFIG.openRouterApiKey) {
    return {
      adapter: createOpenRouterAdapter({
        apiKey: RUNTIME_CONFIG.openRouterApiKey,
        model: RUNTIME_CONFIG.openRouterModel,
        siteUrl: RUNTIME_CONFIG.openRouterSiteUrl,
        siteName: RUNTIME_CONFIG.openRouterSiteName,
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
  const headers = mergeHeaders({ 'Content-Type': 'application/json' }, init?.headers);
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    status: init?.status ?? 200,
    headers,
  });
}

function newRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newGameId(): string {
  return `game-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusForAppError(error: AppError): number {
  if (typeof error.status === 'number') return error.status;
  switch (error.code) {
    case APP_ERROR_CODE.BadRequest:
      return 400;
    case APP_ERROR_CODE.NotFound:
      return 404;
    default:
      return 500;
  }
}

function errorResponse(requestId: string, error: AppError, init?: ResponseInit): Response {
  const status = statusForAppError(error);
  const expose = error.expose ?? status < 500;
  const responseBody: Record<string, unknown> = {
    error: {
      code: error.code,
      message: expose ? error.message : 'Internal server error',
      requestId,
    },
  };

  if (error.code === APP_ERROR_CODE.BadRequest && error.context?.validationErrors) {
    (responseBody.error as Record<string, unknown>).details = error.context.validationErrors;
  }

  return jsonResponse(responseBody, { ...init, status });
}

function parseJsonBody<T>(req: Request, schema: z.ZodType<T>): TE.TaskEither<AppError, T> {
  return pipe(
    TE.tryCatch(
      () => req.json(),
      (cause) =>
        appError(APP_ERROR_CODE.BadRequest, 'Request body must be valid JSON', {
          cause,
        })
    ),
    TE.chain((raw) => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return TE.left(
          appError(APP_ERROR_CODE.BadRequest, 'Invalid request body', {
            cause: parsed.error,
            context: { validationErrors: parsed.error.format() },
          })
        );
      }
      return TE.right(parsed.data);
    })
  );
}

function persistGameState(gameId: string, state: GameState): TE.TaskEither<AppError, void> {
  return pipe(
    TE.fromEither(
      E.tryCatch(
        () => serializeGameState(state),
        (cause) =>
          appError(APP_ERROR_CODE.DbSerializeFailed, 'Failed to serialize game state', {
            cause,
            context: { gameId },
          })
      )
    ),
    TE.chain((stateJson) =>
      pipe(
        upsertWorld({
          id: gameId,
          themePrompt: state.worldConfig.themePrompt,
          seed: state.worldConfig.seed,
          difficulty: state.worldConfig.difficulty,
          stateJson,
        }),
        TE.chain(() => {
          const levelTasks = Object.values(state.world.levels).map((stored) =>
            upsertLevelState(gameId, stored.coord, stored.level, {
              tileFlavors: stored.tileFlavors,
              enemyFlavors: stored.enemyFlavors,
              roomDescription: stored.roomDescription,
            })
          );

          return pipe([...levelTasks, upsertEdges(gameId, state.world.edges)], TE.sequenceArray, TE.map(() => undefined));
        })
      )
    )
  );
}

function loadGameState(gameId: string): TE.TaskEither<AppError, O.Option<GameState>> {
  return pipe(
    getWorldState(gameId),
    TE.map((state) => {
      if (O.isSome(state)) {
        games.set(gameId, state.value);
      }
      return state;
    })
  );
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
  port: RUNTIME_CONFIG.port,

  async fetch(req: Request): Promise<Response> {
    const requestId = newRequestId();
    const url = new URL(req.url);

    // CORS headers for local dev
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Expose-Headers': 'X-Request-Id',
    };
    const responseHeaders = mergeHeaders(corsHeaders, { 'X-Request-Id': requestId });

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    try {
      // Health check
      if (req.method === 'GET' && url.pathname === '/api/health') {
        log('HTTP', 'GET /api/health');
        return jsonResponse(
          {
            status: 'ok',
            aiAdapter: aiAdapterName,
            hasAiKey: !!(RUNTIME_CONFIG.anthropicApiKey || RUNTIME_CONFIG.openRouterApiKey),
          },
          { headers: responseHeaders }
        );
      }

      // Start a new run
      if (req.method === 'POST' && url.pathname === '/api/start-run') {
        const StartRunBody = z.object({
          themePrompt: z.string().min(1),
          seed: z.string().min(1),
          difficulty: z.enum(['Easy', 'Normal', 'Hard']).optional(),
          rulesVersion: z.string().min(1).optional(),
        });

        const bodyResult = await parseJsonBody(req, StartRunBody)();
        if (E.isLeft(bodyResult)) return errorResponse(requestId, bodyResult.left, { headers: responseHeaders });
        const body = bodyResult.right;

        log('HTTP', 'POST /api/start-run', {
          theme: body.themePrompt.slice(0, 50),
          seed: body.seed,
          difficulty: body.difficulty,
        });

        const config: WorldConfig = {
          themePrompt: body.themePrompt,
          seed: body.seed,
          difficulty: body.difficulty ?? 'Normal',
          rulesVersion: body.rulesVersion ?? '0.1.0',
        };

        log('DEBUG', 'Creating initial game state...');
        let state = createInitialGameState(config);
        log('DEBUG', 'Game state created successfully');

        const gameId = newGameId();
        log('HTTP', `Created game ${gameId}`, {
          levelSize: `${state.currentLevel.width}x${state.currentLevel.height}`,
          entityCount: state.currentLevel.entities.length,
        });

        // Generate AI flavor for the starting room
        state = await generateRoomFlavor(state);

        games.set(gameId, state);
        const persisted = await persistGameState(gameId, state)();
        if (E.isLeft(persisted)) {
          log('DB', 'ERROR persisting new game', {
            requestId,
            code: persisted.left.code,
            message: persisted.left.message,
            context: persisted.left.context,
          });
          return errorResponse(requestId, persisted.left, { headers: responseHeaders });
        }

        log('HTTP', `Game ${gameId} ready`);
        return jsonResponse({ gameId, state }, { headers: responseHeaders });
      }

      // Execute a command
      if (req.method === 'POST' && url.pathname === '/api/command') {
        const ActionSchema = z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('Move'), direction: z.enum(['Up', 'Down', 'Left', 'Right']) }),
          z.object({ kind: z.literal('Wait') }),
          z.object({ kind: z.literal('Attack'), direction: z.enum(['Up', 'Down', 'Left', 'Right']) }),
          z.object({ kind: z.literal('Transition') }),
          z.object({ kind: z.literal('Command'), text: z.string().min(1).max(500) }),
        ]);

        const CommandBody = z.object({
          gameId: z.string().min(1),
          action: ActionSchema,
        });

        const bodyResult = await parseJsonBody(req, CommandBody)();
        if (E.isLeft(bodyResult)) return errorResponse(requestId, bodyResult.left, { headers: responseHeaders });
        const body = bodyResult.right;

        let state = games.get(body.gameId);
        if (!state) {
          const loaded = await loadGameState(body.gameId)();
          if (E.isLeft(loaded)) return errorResponse(requestId, loaded.left, { headers: responseHeaders });
          if (O.isSome(loaded.right)) state = loaded.right.value;
        }

        if (!state) {
          const notFound = appError(APP_ERROR_CODE.NotFound, 'Game not found', {
            context: { gameId: body.gameId },
          });
          log('HTTP', 'ERROR: Game not found', { requestId, gameId: body.gameId.slice(-8) });
          return errorResponse(requestId, notFound, { headers: responseHeaders });
        }

        const player = getPlayer(state);
        log('HTTP', 'POST /api/command', {
          gameId: body.gameId.slice(-8),
          action: body.action.kind === 'Command' ? { kind: 'Command', text: body.action.text.slice(0, 80) } : body.action,
          playerPos: player ? `(${player.position.x},${player.position.y})` : 'unknown',
        });
        if (!player) {
          const missingPlayer = appError(APP_ERROR_CODE.Unknown, 'Player not found in game state', {
            context: { gameId: body.gameId, playerId: state.playerId },
          });
          log('HTTP', 'ERROR: Player not found', { requestId, gameId: body.gameId.slice(-8), playerId: state.playerId });
          return errorResponse(requestId, missingPlayer, { headers: responseHeaders });
        }

        let newState: GameState;

        // Handle Transition action specially to generate AI flavor for new levels
        if (body.action.kind === 'Command') {
          newState = applyCommand(state, body.action.text);
        } else if (body.action.kind === 'Transition') {
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
        const persisted = await persistGameState(body.gameId, newState)();
        if (E.isLeft(persisted)) {
          log('DB', 'ERROR persisting game state', {
            requestId,
            gameId: body.gameId.slice(-8),
            code: persisted.left.code,
            message: persisted.left.message,
            context: persisted.left.context,
          });
          return errorResponse(requestId, persisted.left, { headers: responseHeaders });
        }

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

        return jsonResponse({ state: newState, gameStatus }, { headers: responseHeaders });
      }

      // Get current state
      if (req.method === 'GET' && url.pathname.startsWith('/api/game/')) {
        const gameId = url.pathname.replace('/api/game/', '');
        log('HTTP', `GET /api/game/${gameId.slice(-8)}`);

        let state = games.get(gameId);
        if (!state) {
          const loaded = await loadGameState(gameId)();
          if (E.isLeft(loaded)) return errorResponse(requestId, loaded.left, { headers: responseHeaders });
          if (O.isSome(loaded.right)) state = loaded.right.value;
        }

        if (!state) {
          const notFound = appError(APP_ERROR_CODE.NotFound, 'Game not found', {
            context: { gameId },
          });
          log('HTTP', 'ERROR: Game not found', { requestId, gameId: gameId.slice(-8) });
          return errorResponse(requestId, notFound, { headers: responseHeaders });
        }

        return jsonResponse({ state }, { headers: responseHeaders });
      }

      log('HTTP', `404 ${req.method} ${url.pathname}`);
      const notFound = appError(APP_ERROR_CODE.NotFound, 'Not found', {
        context: { method: req.method, pathname: url.pathname },
      });
      return errorResponse(requestId, notFound, { headers: responseHeaders });
    } catch (cause) {
      const appErr = toAppError(cause, {
        code: APP_ERROR_CODE.Unknown,
        message: 'Unhandled exception',
        context: { method: req.method, pathname: url.pathname },
      });

      log('HTTP', 'Unhandled error', {
        requestId,
        code: appErr.code,
        message: appErr.message,
        context: appErr.context,
      });

      return errorResponse(requestId, appErr, { headers: responseHeaders });
    }
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
