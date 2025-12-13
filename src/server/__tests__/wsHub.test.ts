import { describe, expect, test } from 'bun:test';
import { createWsHub, type WsData, type WsLike } from '../wsHub.js';
import { WsServerMessageSchema } from '../../protocol/ws.js';
import type { AppError } from '../../errors/appError.js';
import { O, TE } from '../../utils/fp.js';
import type { GameState, LevelState, Player } from '../../domain/model.js';

type FakeWs = WsLike<WsData> & { sent: string[]; closeCalls: Array<{ code?: number; reason?: string }> };

function makeFakeWs(): FakeWs {
  const ws: FakeWs = {
    data: {},
    sent: [],
    closeCalls: [],
    send(text: string) {
      ws.sent.push(text);
    },
    close(code?: number, reason?: string) {
      ws.closeCalls.push({ code, reason });
    },
  };
  return ws;
}

function drain(ws: FakeWs) {
  const messages = ws.sent.map((raw) => WsServerMessageSchema.parse(JSON.parse(raw)));
  ws.sent.length = 0;
  return messages;
}

function createIdGenerator(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function publicErrorBody(requestId: string, error: AppError) {
  return {
    code: error.code,
    message: error.message || 'Internal server error',
    requestId,
    details: error.context?.validationErrors,
  };
}

function makeLevel(entities: LevelState['entities'] = []): LevelState {
  return {
    id: 'lvl-1',
    depth: 1,
    width: 3,
    height: 3,
    tiles: Array(9).fill('OpenGround'),
    discovered: Array(9).fill(true),
    entities,
  };
}

function makeLevelWithSize(width: number, height: number, entities: LevelState['entities'] = []): LevelState {
  return {
    id: 'lvl-1',
    depth: 1,
    width,
    height,
    tiles: Array(width * height).fill('OpenGround'),
    discovered: Array(width * height).fill(true),
    entities,
  };
}

function makeState(level: LevelState): GameState {
  return {
    worldConfig: { themePrompt: 'test', seed: 'seed', difficulty: 'Normal', rulesVersion: '0.1.0' },
    seed: 123,
    world: {
      levels: {
        [level.id]: { level, coord: { x: 0, y: 0 }, compressedAt: 0 },
      },
      edges: [],
      currentLevelId: level.id,
    },
    currentLevel: level,
    playerId: 'player-1',
    turn: 0,
    messages: [],
    enemyFlavors: {},
    tileFlavors: {},
    roomDescription: 'Room',
  };
}

describe('wsHub', () => {
  test('invalid JSON -> response ok:false BAD_REQUEST', async () => {
    const games = new Map<string, GameState>();
    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (_id) => TE.right(O.none),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const ws = makeFakeWs();
    await hub.message(ws, '{');

    const [msg] = drain(ws);
    expect(msg.type).toBe('response');
    if (msg.type !== 'response') throw new Error('expected response');
    expect(msg.ok).toBe(false);
    if (msg.ok) throw new Error('expected error response');
    expect(msg.requestId).toBe('req-1');
    expect(msg.error.code).toBe('BAD_REQUEST');
  });

  test('schema invalid -> response ok:false uses provided requestId', async () => {
    const games = new Map<string, GameState>();
    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (_id) => TE.right(O.none),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const ws = makeFakeWs();
    await hub.message(ws, JSON.stringify({ type: 'startRun', requestId: 'r1' }));

    const [msg] = drain(ws);
    expect(msg.type).toBe('response');
    if (msg.type !== 'response') throw new Error('expected response');
    expect(msg.ok).toBe(false);
    if (msg.ok) throw new Error('expected error response');
    expect(msg.requestId).toBe('r1');
    expect(msg.error.code).toBe('BAD_REQUEST');
    expect(msg.error.details).toBeDefined();
  });

  test('startRun -> join -> action broadcasts state updates and leave unsubscribes', async () => {
    const games = new Map<string, GameState>();
    const newReqId = createIdGenerator('req');
    const newGameId = createIdGenerator('game');

    const hub = createWsHub({
      newRequestId: newReqId,
      newGameId,
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (id) => TE.right(O.fromNullable(games.get(id))),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const wsA = makeFakeWs();
    const wsB = makeFakeWs();

    await hub.message(
      wsA,
      JSON.stringify({
        type: 'startRun',
        requestId: 'start-1',
        playerId: '00000000-0000-0000-0000-000000000001',
        playerName: 'Alice',
        themePrompt: 'test',
        seed: 'seed',
        difficulty: 'Normal',
        rulesVersion: '0.1.0',
      })
    );

    const startMsgs = drain(wsA);
    const startResp = startMsgs.find((m) => m.type === 'response' && m.requestId === 'start-1');
    if (!startResp || startResp.type !== 'response' || !startResp.ok) throw new Error('expected startRun ok response');
    const gameId = (startResp.data as any)?.gameId as string;
    expect(gameId).toBe('game-1');
    expect(wsA.data.gameId).toBe('game-1');
    expect(wsA.data.playerEntityId).toBe('p:00000000-0000-0000-0000-000000000001');
    expect(games.has('game-1')).toBe(true);

    const startState = startMsgs.find((m) => m.type === 'state' && m.gameId === gameId);
    if (!startState || startState.type !== 'state') throw new Error('expected startRun state broadcast');
    expect(startState.gameStatus).toBe('active');

    await hub.message(
      wsB,
      JSON.stringify({
        type: 'join',
        requestId: 'join-1',
        gameId,
        playerId: '00000000-0000-0000-0000-000000000002',
        playerName: 'Bob',
      })
    );

    const joinMsgsB = drain(wsB);
    const joinResp = joinMsgsB.find((m) => m.type === 'response' && m.requestId === 'join-1');
    if (!joinResp || joinResp.type !== 'response' || !joinResp.ok) throw new Error('expected join ok response');
    expect(wsB.data.gameId).toBe('game-1');
    expect(wsB.data.playerEntityId).toBe('p:00000000-0000-0000-0000-000000000002');

    const joinBroadcastB = joinMsgsB.find((m) => m.type === 'state' && m.gameId === gameId);
    if (!joinBroadcastB || joinBroadcastB.type !== 'state') throw new Error('expected join state broadcast to joiner');

    const joinMsgsA = drain(wsA);
    const joinBroadcastA = joinMsgsA.find((m) => m.type === 'state' && m.gameId === gameId);
    if (!joinBroadcastA || joinBroadcastA.type !== 'state') throw new Error('expected join state broadcast to existing socket');

    const joinedState = joinBroadcastB.state as any;
    const players = joinedState?.currentLevel?.entities?.filter?.((e: any) => e.kind === 'Player') ?? [];
    expect(players).toHaveLength(2);
    expect(players.some((p: any) => p.name === 'Alice')).toBe(true);
    expect(players.some((p: any) => p.name === 'Bob')).toBe(true);
    expect((joinedState?.messages ?? []).some((m: any) => String(m.text).includes('joins the corridor'))).toBe(true);

    await hub.message(
      wsA,
      JSON.stringify({
        type: 'action',
        requestId: 'say-1',
        gameId,
        playerId: '00000000-0000-0000-0000-000000000001',
        playerName: 'Alice',
        action: { kind: 'Command', text: '/say hi' },
      })
    );

    const sayMsgsA = drain(wsA);
    const sayResp = sayMsgsA.find((m) => m.type === 'response' && m.requestId === 'say-1');
    if (!sayResp || sayResp.type !== 'response' || !sayResp.ok) throw new Error('expected action ok response');
    const sayBroadcastA = sayMsgsA.find((m) => m.type === 'state' && m.gameId === gameId);
    if (!sayBroadcastA || sayBroadcastA.type !== 'state') throw new Error('expected state broadcast after say');

    const sayMsgsB = drain(wsB);
    const sayBroadcastB = sayMsgsB.find((m) => m.type === 'state' && m.gameId === gameId);
    if (!sayBroadcastB || sayBroadcastB.type !== 'state') throw new Error('expected state broadcast to other socket after say');

    const saidState = sayBroadcastB.state as any;
    const texts = (saidState?.messages ?? []).map((m: any) => m.text);
    expect(texts.some((t: any) => String(t).includes('Alice: hi'))).toBe(true);

    await hub.message(wsB, JSON.stringify({ type: 'leave', requestId: 'leave-1', gameId }));
    const leaveMsgs = drain(wsB);
    const leaveResp = leaveMsgs.find((m) => m.type === 'response' && m.requestId === 'leave-1');
    if (!leaveResp || leaveResp.type !== 'response' || !leaveResp.ok) throw new Error('expected leave ok response');
    expect(wsB.data.gameId).toBeUndefined();
    expect(wsB.data.playerId).toBeUndefined();
    expect(wsB.data.playerEntityId).toBeUndefined();

    await hub.message(
      wsA,
      JSON.stringify({
        type: 'action',
        requestId: 'say-2',
        gameId,
        playerId: '00000000-0000-0000-0000-000000000001',
        playerName: 'Alice',
        action: { kind: 'Command', text: '/say bye' },
      })
    );

    drain(wsA);
    const afterLeaveMsgsB = drain(wsB);
    expect(afterLeaveMsgsB).toHaveLength(0);
  });

  test('broadcastState sets gameStatus gameOver when player is dead', async () => {
    const games = new Map<string, GameState>();
    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (id) => TE.right(O.fromNullable(games.get(id))),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const ws = makeFakeWs();
    await hub.message(
      ws,
      JSON.stringify({
        type: 'startRun',
        requestId: 'start-1',
        playerId: '00000000-0000-0000-0000-000000000001',
        playerName: 'Alice',
        themePrompt: 'test',
        seed: 'seed',
      })
    );
    drain(ws);

    const state = games.get('game-1');
    if (!state) throw new Error('expected stored game state');
    const playerEntityId = ws.data.playerEntityId;
    if (!playerEntityId) throw new Error('expected playerEntityId');

    const deadState: GameState = {
      ...state,
      currentLevel: {
        ...state.currentLevel,
        entities: state.currentLevel.entities.map((e) =>
          e.kind === 'Player' && e.id === playerEntityId ? { ...e, hp: 0 } : e
        ),
      },
    };
    games.set('game-1', deadState);
    hub.broadcastState('game-1', deadState);

    const [msg] = drain(ws);
    expect(msg.type).toBe('state');
    if (msg.type !== 'state') throw new Error('expected state');
    expect(msg.gameStatus).toBe('gameOver');
  });

  test('join missing game -> response ok:false NOT_FOUND', async () => {
    const games = new Map<string, GameState>();
    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (_id) => TE.right(O.none),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const ws = makeFakeWs();
    await hub.message(
      ws,
      JSON.stringify({
        type: 'join',
        requestId: 'join-1',
        gameId: 'missing',
        playerId: '00000000-0000-0000-0000-000000000001',
        playerName: 'Alice',
      })
    );

    const [msg] = drain(ws);
    expect(msg.type).toBe('response');
    if (msg.type !== 'response') throw new Error('expected response');
    expect(msg.ok).toBe(false);
    if (msg.ok) throw new Error('expected error response');
    expect(msg.requestId).toBe('join-1');
    expect(msg.error.code).toBe('NOT_FOUND');
  });

  test('invalid action payload -> response ok:false BAD_REQUEST', async () => {
    const games = new Map<string, GameState>();
    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (_id) => TE.right(O.none),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const ws = makeFakeWs();
    await hub.message(
      ws,
      JSON.stringify({
        type: 'action',
        requestId: 'a1',
        gameId: 'game-1',
        playerId: '00000000-0000-0000-0000-000000000001',
        action: { kind: 'Command', text: '' },
      })
    );

    const [msg] = drain(ws);
    expect(msg.type).toBe('response');
    if (msg.type !== 'response') throw new Error('expected response');
    expect(msg.ok).toBe(false);
    if (msg.ok) throw new Error('expected error response');
    expect(msg.requestId).toBe('a1');
    expect(msg.error.code).toBe('BAD_REQUEST');
    expect(msg.error.details).toBeDefined();
  });

  test('non-command actions are buffered and applied on tick', async () => {
    const games = new Map<string, GameState>();
    games.set('game-1', makeState(makeLevel()));

    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (id) => TE.right(O.fromNullable(games.get(id))),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const ws = makeFakeWs();

    await hub.message(
      ws,
      JSON.stringify({
        type: 'join',
        requestId: 'join-1',
        gameId: 'game-1',
        playerId: '00000000-0000-0000-0000-000000000001',
        playerName: 'Alice',
      })
    );
    drain(ws);

    const stateBefore = games.get('game-1');
    if (!stateBefore) throw new Error('expected game state');
    const playerEntityId = ws.data.playerEntityId;
    if (!playerEntityId) throw new Error('expected playerEntityId');
    const playerBefore = stateBefore.currentLevel.entities.find(
      (e): e is Player => e.kind === 'Player' && e.id === playerEntityId
    );
    if (!playerBefore) throw new Error('expected player');

    await hub.message(
      ws,
      JSON.stringify({
        type: 'action',
        requestId: 'a1',
        gameId: 'game-1',
        playerId: '00000000-0000-0000-0000-000000000001',
        action: { kind: 'Move', direction: 'Right' },
      })
    );

    const afterActionMsgs = drain(ws);
    expect(afterActionMsgs.some((m) => m.type === 'state')).toBe(false);

    await hub.tickGame('game-1');
    const tickMsgs = drain(ws);
    const tickStateMsg = tickMsgs.find((m) => m.type === 'state');
    if (!tickStateMsg || tickStateMsg.type !== 'state') throw new Error('expected state broadcast on tick');

    const playerAfter = (tickStateMsg.state as any)?.currentLevel?.entities?.find?.(
      (e: any) => e.kind === 'Player' && e.id === playerEntityId
    ) as Player | undefined;
    if (!playerAfter) throw new Error('expected player after tick');
    expect(playerAfter.position.x).toBe(playerBefore.position.x + 1);
  });

  test('latest action per tick wins', async () => {
    const games = new Map<string, GameState>();
    games.set('game-1', makeState(makeLevel()));

    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (id) => TE.right(O.fromNullable(games.get(id))),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const ws = makeFakeWs();

    await hub.message(
      ws,
      JSON.stringify({
        type: 'join',
        requestId: 'join-1',
        gameId: 'game-1',
        playerId: '00000000-0000-0000-0000-000000000001',
        playerName: 'Alice',
      })
    );
    drain(ws);

    await hub.message(
      ws,
      JSON.stringify({
        type: 'action',
        requestId: 'a1',
        gameId: 'game-1',
        playerId: '00000000-0000-0000-0000-000000000001',
        action: { kind: 'Move', direction: 'Right' },
      })
    );

    await hub.message(
      ws,
      JSON.stringify({
        type: 'action',
        requestId: 'a2',
        gameId: 'game-1',
        playerId: '00000000-0000-0000-0000-000000000001',
        action: { kind: 'Move', direction: 'Left' },
      })
    );

    drain(ws);

    await hub.tickGame('game-1');
    const tickMsgs = drain(ws);
    const tickStateMsg = tickMsgs.find((m) => m.type === 'state');
    if (!tickStateMsg || tickStateMsg.type !== 'state') throw new Error('expected state broadcast on tick');

    const playerEntityId = ws.data.playerEntityId;
    if (!playerEntityId) throw new Error('expected playerEntityId');
    const playerAfter = (tickStateMsg.state as any)?.currentLevel?.entities?.find?.(
      (e: any) => e.kind === 'Player' && e.id === playerEntityId
    ) as Player | undefined;
    if (!playerAfter) throw new Error('expected player after tick');
    expect(playerAfter.position.x).toBe(0);
  });

  test('duplicate sockets for same player replace the existing session', async () => {
    const games = new Map<string, GameState>();
    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (id) => TE.right(O.fromNullable(games.get(id))),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const playerId = '00000000-0000-0000-0000-000000000001';
    const wsA = makeFakeWs();
    const wsB = makeFakeWs();

    await hub.message(
      wsA,
      JSON.stringify({
        type: 'startRun',
        requestId: 'start-1',
        playerId,
        playerName: 'Alice',
        themePrompt: 'test',
        seed: 'seed',
      })
    );

    const startMsgsA = drain(wsA);
    const startResp = startMsgsA.find((m) => m.type === 'response' && m.requestId === 'start-1');
    if (!startResp || startResp.type !== 'response' || !startResp.ok) throw new Error('expected startRun ok response');
    const gameId = (startResp.data as any)?.gameId as string;
    if (!gameId) throw new Error('expected gameId');

    // Join with the same playerId on a second socket; should kick the first session.
    await hub.message(
      wsB,
      JSON.stringify({
        type: 'join',
        requestId: 'join-1',
        gameId,
        playerId,
        playerName: 'Alice',
      })
    );

    drain(wsB);

    expect(wsA.closeCalls).toHaveLength(1);
    expect(wsA.closeCalls[0]?.code).toBe(4000);
    expect(wsA.closeCalls[0]?.reason).toBe('Session replaced');
    expect(wsA.data.gameId).toBeUndefined();
    expect(wsA.data.playerId).toBeUndefined();
    expect(wsA.data.playerEntityId).toBeUndefined();
  });

  test('multiple players buffer actions and apply them on the same tick', async () => {
    const games = new Map<string, GameState>();
    games.set('game-1', makeState(makeLevelWithSize(5, 5)));

    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, state) => games.set(id, state),
      loadGameState: (id) => TE.right(O.fromNullable(games.get(id))),
      persistGameState: (_id, _state) => TE.right(undefined),
      generateRoomFlavor: async (s) => s,
      listPlayers: (_limit) => TE.right([]),
      getPlayerProfile: (_playerId) => TE.right(O.none),
      getOrCreatePlayerProfile: ({ playerId, playerName }) =>
        TE.right({
          playerId,
          name: playerName ?? `Wanderer-${playerId.slice(0, 6)}`,
          description: 'A traveler of the infinite corridor.',
          tokenChar: '@',
        }),
      createPlayerProfile: ({ playerId, prompt }) =>
        TE.right({
          playerId: playerId ?? '00000000-0000-0000-0000-000000000000',
          name: 'Player',
          description: prompt,
          tokenChar: '@',
        }),
      listWorlds: (_params) => TE.right([]),
      touchWorldPlayer: (_params) => TE.right(undefined),
      publicErrorBody,
    });

    const wsA = makeFakeWs();
    const wsB = makeFakeWs();
    const playerAId = '00000000-0000-0000-0000-000000000001';
    const playerBId = '00000000-0000-0000-0000-000000000002';

    await hub.message(
      wsA,
      JSON.stringify({
        type: 'join',
        requestId: 'join-a',
        gameId: 'game-1',
        playerId: playerAId,
        playerName: 'Alice',
      })
    );
    drain(wsA);

    await hub.message(
      wsB,
      JSON.stringify({
        type: 'join',
        requestId: 'join-b',
        gameId: 'game-1',
        playerId: playerBId,
        playerName: 'Bob',
      })
    );
    drain(wsB);
    drain(wsA);

    const stateBefore = games.get('game-1');
    if (!stateBefore) throw new Error('expected game state');

    const actorA = wsA.data.playerEntityId;
    const actorB = wsB.data.playerEntityId;
    if (!actorA || !actorB) throw new Error('expected player entity ids');

    const playerBeforeA = stateBefore.currentLevel.entities.find((e): e is Player => e.kind === 'Player' && e.id === actorA);
    const playerBeforeB = stateBefore.currentLevel.entities.find((e): e is Player => e.kind === 'Player' && e.id === actorB);
    if (!playerBeforeA || !playerBeforeB) throw new Error('expected both players in state');

    await hub.message(
      wsA,
      JSON.stringify({
        type: 'action',
        requestId: 'a1',
        gameId: 'game-1',
        playerId: playerAId,
        action: { kind: 'Move', direction: 'Right' },
      })
    );

    await hub.message(
      wsB,
      JSON.stringify({
        type: 'action',
        requestId: 'b1',
        gameId: 'game-1',
        playerId: playerBId,
        action: { kind: 'Move', direction: 'Left' },
      })
    );

    const msgsA = drain(wsA);
    const msgsB = drain(wsB);
    expect(msgsA.some((m) => m.type === 'state')).toBe(false);
    expect(msgsB.some((m) => m.type === 'state')).toBe(false);

    await hub.tickGame('game-1');

    const tickMsgsA = drain(wsA);
    const tickMsgsB = drain(wsB);
    const stateMsgA = tickMsgsA.find((m) => m.type === 'state');
    const stateMsgB = tickMsgsB.find((m) => m.type === 'state');
    if (!stateMsgA || stateMsgA.type !== 'state') throw new Error('expected state broadcast to player A');
    if (!stateMsgB || stateMsgB.type !== 'state') throw new Error('expected state broadcast to player B');

    const playerAfterA = (stateMsgA.state as any)?.currentLevel?.entities?.find?.(
      (e: any) => e.kind === 'Player' && e.id === actorA
    ) as Player | undefined;
    const playerAfterB = (stateMsgA.state as any)?.currentLevel?.entities?.find?.(
      (e: any) => e.kind === 'Player' && e.id === actorB
    ) as Player | undefined;
    if (!playerAfterA || !playerAfterB) throw new Error('expected players after tick');

    expect(playerAfterA.position.x).toBe(playerBeforeA.position.x + 1);
    expect(playerAfterB.position.x).toBe(playerBeforeB.position.x - 1);
  });
});
