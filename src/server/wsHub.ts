import { createInitialGameState, applyTick, getPlayerById } from '../engine/game.js';
import type { Action, EntityId, GameState, WorldConfig } from '../domain/model.js';
import { APP_ERROR_CODE, appError, toAppError, type AppError } from '../errors/appError.js';
import { E, O, TE } from '../utils/fp.js';
import { applyCommandForActor } from './commands.js';
import { ensurePlayerInGame } from './players.js';
import { WsClientMessageSchema, type PublicError, type WsClientMessage, type WsServerMessage } from '../protocol/ws.js';
import type { PlayerProfilePublic, PlayerProfileSummary, WorldSummary } from '../protocol/ws.js';

export type WsData = {
  gameId?: string;
  playerId?: string;
  playerEntityId?: string;
};

export type WsLike<Data extends Record<string, unknown> = WsData> = {
  data: Data;
  send: (data: string) => void;
  close?: (code?: number, reason?: string) => void;
};

export interface WsHubDeps {
  newRequestId: () => string;
  newGameId: () => string;
  tickMs: number;
  startTickTimers?: boolean;
  getGame: (gameId: string) => GameState | undefined;
  setGame: (gameId: string, state: GameState) => void;
  loadGameState: (gameId: string) => TE.TaskEither<AppError, O.Option<GameState>>;
  persistGameState: (gameId: string, state: GameState) => TE.TaskEither<AppError, void>;
  generateRoomFlavor: (state: GameState) => Promise<GameState>;
  listPlayers: (limit: number) => TE.TaskEither<AppError, PlayerProfileSummary[]>;
  getPlayerProfile: (playerId: string) => TE.TaskEither<AppError, O.Option<PlayerProfilePublic>>;
  getOrCreatePlayerProfile: (params: { playerId: string; playerName?: string }) => TE.TaskEither<AppError, PlayerProfilePublic>;
  createPlayerProfile: (params: { playerId?: string; prompt: string }) => TE.TaskEither<AppError, PlayerProfilePublic>;
  listWorlds: (params: { playerId?: string; limit: number }) => TE.TaskEither<AppError, WorldSummary[]>;
  touchWorldPlayer: (params: { worldId: string; playerId: string }) => TE.TaskEither<AppError, void>;
  publicErrorBody: (requestId: string, error: AppError) => PublicError;
  log?: (category: string, message: string, data?: unknown) => void;
}

export interface WsHub {
  message: (ws: WsLike<WsData>, message: string | ArrayBuffer | Uint8Array) => Promise<void>;
  close: (ws: WsLike<WsData>) => void;
  broadcastState: (gameId: string, state: GameState) => void;
  tickGame: (gameId: string) => Promise<void>;
}

const decoder = new TextDecoder();

function decodeMessage(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === 'string') return message;
  if (message instanceof Uint8Array) return decoder.decode(message);
  return decoder.decode(new Uint8Array(message));
}

export function createWsHub(deps: WsHubDeps): WsHub {
  const socketsByGameId = new Map<string, Set<WsLike<WsData>>>();
  const queuedActionsByGameId = new Map<string, Map<EntityId, Action>>();
  const tickTimersByGameId = new Map<string, ReturnType<typeof setInterval>>();
  const tickingGames = new Set<string>();

  function tryClose(ws: WsLike<WsData>, code?: number, reason?: string): void {
    try {
      ws.close?.(code, reason);
    } catch {
      // ignore
    }
  }

  function safeSend(ws: WsLike<WsData>, msg: WsServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore send failures; close handler will clean up
    }
  }

  function subscribeSocket(ws: WsLike<WsData>, gameId: string): void {
    unsubscribeSocket(ws);
    let set = socketsByGameId.get(gameId);
    if (!set) {
      set = new Set();
      socketsByGameId.set(gameId, set);
    }

    const actorId = ws.data.playerEntityId;
    if (actorId) {
      const duplicates: WsLike<WsData>[] = [];
      for (const other of set) {
        if (other === ws) continue;
        if (other.data.playerEntityId === actorId) duplicates.push(other);
      }

      for (const other of duplicates) {
        unsubscribeSocket(other);
        other.data.playerId = undefined;
        other.data.playerEntityId = undefined;
        tryClose(other, 4000, 'Session replaced');
      }
    }

    set.add(ws);
    ws.data.gameId = gameId;

    ensureTickTimer(gameId);
  }

  function unsubscribeSocket(ws: WsLike<WsData>): void {
    const gameId = ws.data.gameId;
    if (!gameId) return;
    const set = socketsByGameId.get(gameId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        socketsByGameId.delete(gameId);
        stopTickTimer(gameId);
      }
    }
    ws.data.gameId = undefined;
  }

  function ensureTickTimer(gameId: string): void {
    if (tickTimersByGameId.has(gameId)) return;
    if (deps.startTickTimers === false) return;
    const timer = setInterval(() => {
      void tickGame(gameId);
    }, deps.tickMs);
    tickTimersByGameId.set(gameId, timer);
  }

  function stopTickTimer(gameId: string): void {
    const timer = tickTimersByGameId.get(gameId);
    if (!timer) return;
    clearInterval(timer);
    tickTimersByGameId.delete(gameId);
  }

  function enqueueAction(gameId: string, actorId: EntityId, action: Action): void {
    let queued = queuedActionsByGameId.get(gameId);
    if (!queued) {
      queued = new Map();
      queuedActionsByGameId.set(gameId, queued);
    }
    queued.set(actorId, action);
  }

  async function tickGame(gameId: string): Promise<void> {
    if (tickingGames.has(gameId)) return;
    tickingGames.add(gameId);

    try {
      const sockets = socketsByGameId.get(gameId);
      if (!sockets || sockets.size === 0) return;

      const queued = queuedActionsByGameId.get(gameId);
      const actions = queued ? [...queued.entries()] : [];
      if (queued) queued.clear();

      let state = deps.getGame(gameId);
      if (!state) {
        const loaded = await deps.loadGameState(gameId)();
        if (E.isLeft(loaded)) {
          deps.log?.('WS', 'tick loadGameState failed', { gameId: gameId.slice(-8), code: loaded.left.code });
          return;
        }
        if (O.isSome(loaded.right)) state = loaded.right.value;
      }
      if (!state) return;

      const tickResult = applyTick(
        state,
        actions.map(([actorId, action]) => ({ actorId, action }))
      );
      let newState = tickResult.state;

      if (tickResult.transition?.isNewLevel && tickResult.transition.newLevelId) {
        newState = await deps.generateRoomFlavor(newState);
      }

      deps.setGame(gameId, newState);

      const persisted = await deps.persistGameState(gameId, newState)();
      if (E.isLeft(persisted)) {
        deps.log?.('DB', 'ERROR persisting tick state', {
          gameId: gameId.slice(-8),
          code: persisted.left.code,
          message: persisted.left.message,
        });
        // Keep running in memory even if persistence fails.
      }

      broadcastState(gameId, newState);
    } finally {
      tickingGames.delete(gameId);
    }
  }

  function gameStatusFor(ws: WsLike<WsData>, state: GameState): 'active' | 'gameOver' {
    const playerEntityId = ws.data.playerEntityId;
    if (!playerEntityId) return 'active';
    const player = getPlayerById(state, playerEntityId);
    return player && player.hp > 0 ? 'active' : 'gameOver';
  }

  function broadcastState(gameId: string, state: GameState): void {
    const sockets = socketsByGameId.get(gameId);
    if (!sockets || sockets.size === 0) return;

    for (const ws of sockets) {
      safeSend(ws, {
        type: 'state',
        gameId,
        state,
        gameStatus: gameStatusFor(ws, state),
      });
    }
  }

  async function message(ws: WsLike<WsData>, message: string | ArrayBuffer | Uint8Array): Promise<void> {
    const text = decodeMessage(message);

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (cause) {
      const requestId = deps.newRequestId();
      const err = appError(APP_ERROR_CODE.BadRequest, 'Message must be valid JSON', { cause });
      safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, err) });
      return;
    }

    const parsed = WsClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      const requestId =
        typeof raw === 'object' && raw && 'requestId' in raw
          ? String((raw as { requestId?: unknown }).requestId)
          : deps.newRequestId();
      const err = appError(APP_ERROR_CODE.BadRequest, 'Invalid message', {
        cause: parsed.error,
        context: { validationErrors: parsed.error.format() },
      });
      safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, err) });
      return;
    }

    const msg: WsClientMessage = parsed.data;
    const requestId = msg.requestId;

    try {
      if (msg.type === 'leave') {
        unsubscribeSocket(ws);
        ws.data.playerEntityId = undefined;
        ws.data.playerId = undefined;
        safeSend(ws, { type: 'response', requestId, ok: true });
        return;
      }

      if (msg.type === 'startRun') {
        if (ws.data.playerId && ws.data.playerId !== msg.playerId) {
          const err = appError(APP_ERROR_CODE.BadRequest, 'playerId does not match this WebSocket session', {
            context: { sessionPlayerId: ws.data.playerId, messagePlayerId: msg.playerId },
          });
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, err) });
          return;
        }

        deps.log?.('WS', 'startRun', { requestId, playerId: msg.playerId });

        const profileResult = await deps.getOrCreatePlayerProfile({ playerId: msg.playerId, playerName: msg.playerName })();
        if (E.isLeft(profileResult)) {
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, profileResult.left) });
          return;
        }
        const profile = profileResult.right;

        const config: WorldConfig = {
          themePrompt: msg.themePrompt,
          seed: msg.seed,
          difficulty: msg.difficulty ?? 'Normal',
          rulesVersion: msg.rulesVersion ?? '0.1.0',
        };

        let state = createInitialGameState(config);
        const ensured = ensurePlayerInGame(state, {
          playerId: msg.playerId,
          profile: { name: profile.name, description: profile.description, tokenChar: profile.tokenChar },
        });
        state = ensured.state;
        state = await deps.generateRoomFlavor(state);

        const gameId = deps.newGameId();
        deps.setGame(gameId, state);

        const persisted = await deps.persistGameState(gameId, state)();
        if (E.isLeft(persisted)) {
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, persisted.left) });
          return;
        }

        ws.data.playerId = msg.playerId;
        ws.data.playerEntityId = ensured.playerEntityId;
        subscribeSocket(ws, gameId);

        const touched = await deps.touchWorldPlayer({ worldId: gameId, playerId: msg.playerId })();
        if (E.isLeft(touched)) {
          deps.log?.('DB', 'touchWorldPlayer failed after startRun', { code: touched.left.code, message: touched.left.message });
        }

        safeSend(ws, { type: 'response', requestId, ok: true, data: { gameId, state } });
        broadcastState(gameId, state);
        return;
      }

      if (msg.type === 'join') {
        if (ws.data.playerId && ws.data.playerId !== msg.playerId) {
          const err = appError(APP_ERROR_CODE.BadRequest, 'playerId does not match this WebSocket session', {
            context: { sessionPlayerId: ws.data.playerId, messagePlayerId: msg.playerId },
          });
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, err) });
          return;
        }

        deps.log?.('WS', 'join', { requestId, gameId: msg.gameId.slice(-8), playerId: msg.playerId });

        let state = deps.getGame(msg.gameId);
        if (!state) {
          const loaded = await deps.loadGameState(msg.gameId)();
          if (E.isLeft(loaded)) {
            safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, loaded.left) });
            return;
          }
          if (O.isSome(loaded.right)) state = loaded.right.value;
        }

        if (!state) {
          const notFound = appError(APP_ERROR_CODE.NotFound, 'Game not found', { context: { gameId: msg.gameId } });
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, notFound) });
          return;
        }

        const profileResult = await deps.getOrCreatePlayerProfile({ playerId: msg.playerId, playerName: msg.playerName })();
        if (E.isLeft(profileResult)) {
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, profileResult.left) });
          return;
        }
        const profile = profileResult.right;

        const ensured = ensurePlayerInGame(state, {
          playerId: msg.playerId,
          profile: { name: profile.name, description: profile.description, tokenChar: profile.tokenChar },
        });
        const newState = ensured.state;
        deps.setGame(msg.gameId, newState);

        const persisted = await deps.persistGameState(msg.gameId, newState)();
        if (E.isLeft(persisted)) {
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, persisted.left) });
          return;
        }

        ws.data.playerId = msg.playerId;
        ws.data.playerEntityId = ensured.playerEntityId;
        subscribeSocket(ws, msg.gameId);

        const touched = await deps.touchWorldPlayer({ worldId: msg.gameId, playerId: msg.playerId })();
        if (E.isLeft(touched)) {
          deps.log?.('DB', 'touchWorldPlayer failed after join', { code: touched.left.code, message: touched.left.message });
        }

        safeSend(ws, { type: 'response', requestId, ok: true, data: { state: newState } });
        broadcastState(msg.gameId, newState);
        return;
      }

      if (msg.type === 'action') {
        if (ws.data.playerId && ws.data.playerId !== msg.playerId) {
          const err = appError(APP_ERROR_CODE.BadRequest, 'playerId does not match this WebSocket session', {
            context: { sessionPlayerId: ws.data.playerId, messagePlayerId: msg.playerId },
          });
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, err) });
          return;
        }

        let state = deps.getGame(msg.gameId);
        if (!state) {
          const loaded = await deps.loadGameState(msg.gameId)();
          if (E.isLeft(loaded)) {
            safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, loaded.left) });
            return;
          }
          if (O.isSome(loaded.right)) state = loaded.right.value;
        }

        if (!state) {
          const notFound = appError(APP_ERROR_CODE.NotFound, 'Game not found', { context: { gameId: msg.gameId } });
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, notFound) });
          return;
        }

        const profileResult = await deps.getOrCreatePlayerProfile({ playerId: msg.playerId, playerName: msg.playerName })();
        if (E.isLeft(profileResult)) {
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, profileResult.left) });
          return;
        }
        const profile = profileResult.right;

        const ensured = ensurePlayerInGame(state, {
          playerId: msg.playerId,
          profile: { name: profile.name, description: profile.description, tokenChar: profile.tokenChar },
        });
        state = ensured.state;
        ws.data.playerId = msg.playerId;
        ws.data.playerEntityId = ensured.playerEntityId;
        subscribeSocket(ws, msg.gameId);

        const player = getPlayerById(state, ensured.playerEntityId);
        if (!player) {
          const missing = appError(APP_ERROR_CODE.Unknown, 'Player not found in game state', {
            context: { gameId: msg.gameId, playerId: msg.playerId },
          });
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, missing) });
          return;
        }

        if (msg.action.kind === 'Command') {
          const newState = applyCommandForActor(state, player.id, msg.action.text);
          deps.setGame(msg.gameId, newState);
          const persisted = await deps.persistGameState(msg.gameId, newState)();
          if (E.isLeft(persisted)) {
            safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, persisted.left) });
            return;
          }
          safeSend(ws, { type: 'response', requestId, ok: true });
          broadcastState(msg.gameId, newState);
          return;
        }

        enqueueAction(msg.gameId, player.id, msg.action);
        safeSend(ws, { type: 'response', requestId, ok: true });
        return;
      }

      if (msg.type === 'listPlayers') {
        const limit = msg.limit ?? 20;
        const result = await deps.listPlayers(limit)();
        if (E.isLeft(result)) {
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, result.left) });
          return;
        }
        safeSend(ws, { type: 'response', requestId, ok: true, data: { players: result.right } });
        return;
      }

      if (msg.type === 'getPlayerProfile') {
        const result = await deps.getPlayerProfile(msg.playerId)();
        if (E.isLeft(result)) {
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, result.left) });
          return;
        }

        safeSend(ws, {
          type: 'response',
          requestId,
          ok: true,
          data: { player: O.isSome(result.right) ? result.right.value : undefined },
        });
        return;
      }

      if (msg.type === 'createPlayerProfile') {
        const result = await deps.createPlayerProfile({ playerId: msg.playerId, prompt: msg.prompt })();
        if (E.isLeft(result)) {
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, result.left) });
          return;
        }
        safeSend(ws, { type: 'response', requestId, ok: true, data: { player: result.right } });
        return;
      }

      if (msg.type === 'listWorlds') {
        const limit = msg.limit ?? 20;
        const result = await deps.listWorlds({ playerId: msg.playerId, limit })();
        if (E.isLeft(result)) {
          safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, result.left) });
          return;
        }
        safeSend(ws, { type: 'response', requestId, ok: true, data: { worlds: result.right } });
        return;
      }
    } catch (cause) {
      const err = toAppError(cause, { code: APP_ERROR_CODE.Unknown, message: 'Unhandled WebSocket exception' });
      safeSend(ws, { type: 'response', requestId, ok: false, error: deps.publicErrorBody(requestId, err) });
    }
  }

  function close(ws: WsLike<WsData>): void {
    unsubscribeSocket(ws);
  }

  return { message, close, broadcastState, tickGame };
}
