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

function makeStateWithSecondLevel(params: { levelA: LevelState; levelB: LevelState; edge: GameState['world']['edges'][number] }): GameState {
  return {
    worldConfig: { themePrompt: 'test', seed: 'seed', difficulty: 'Normal', rulesVersion: '0.1.0' },
    seed: 123,
    world: {
      levels: {
        [params.levelA.id]: { level: params.levelA, coord: { x: 0, y: 0 }, compressedAt: 0 },
        [params.levelB.id]: { level: params.levelB, coord: { x: 1, y: 0 }, compressedAt: 0 },
      },
      edges: [params.edge],
      currentLevelId: params.levelA.id,
    },
    currentLevel: params.levelA,
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

  test('duplicate sockets for same player are rejected (no session takeover)', async () => {
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

    // Join with the same playerId on a second socket; should be rejected without kicking the first session.
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

    const joinMsgsB = drain(wsB);
    const joinResp = joinMsgsB.find((m) => m.type === 'response' && m.requestId === 'join-1');
    if (!joinResp || joinResp.type !== 'response' || joinResp.ok) throw new Error('expected join response error');
    expect(joinResp.error.code).toBe('ALREADY_LOGGED_IN');

    expect(wsA.closeCalls).toHaveLength(0);
    expect(wsA.data.gameId).toBe(gameId);
    expect(wsA.data.playerId).toBe(playerId);
    expect(wsA.data.playerEntityId).toBe(`p:${playerId}`);

    expect(wsB.data.gameId).toBeUndefined();
    expect(wsB.data.playerId).toBeUndefined();
    expect(wsB.data.playerEntityId).toBeUndefined();
  });

  test('playerId session lock releases on leave', async () => {
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

    await hub.message(wsA, JSON.stringify({ type: 'leave', requestId: 'leave-1' }));
    const leaveMsgsA = drain(wsA);
    const leaveResp = leaveMsgsA.find((m) => m.type === 'response' && m.requestId === 'leave-1');
    if (!leaveResp || leaveResp.type !== 'response' || !leaveResp.ok) throw new Error('expected leave ok response');

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

    const joinMsgsB = drain(wsB);
    const joinResp = joinMsgsB.find((m) => m.type === 'response' && m.requestId === 'join-1');
    if (!joinResp || joinResp.type !== 'response' || !joinResp.ok) throw new Error('expected join ok response');
    expect(wsB.data.playerId).toBe(playerId);
    expect(wsB.data.gameId).toBe(gameId);
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

  test('transition moves only the acting player; other player stays on source level', async () => {
    const levelA = { ...makeLevelWithSize(3, 3), id: 'lvl-a' };
    const tilesA = [...levelA.tiles];
    tilesA[1 * levelA.width + 1] = 'Transition';
    const levelAWithPortal: LevelState = { ...levelA, tiles: tilesA };

    const levelB = { ...makeLevelWithSize(3, 3), id: 'lvl-b' };
    const state = makeStateWithSecondLevel({
      levelA: levelAWithPortal,
      levelB,
      edge: {
        id: 'edge-a-b',
        fromLevelId: levelAWithPortal.id,
        fromPosition: { x: 1, y: 1 },
        toLevelId: levelB.id,
        toPosition: { x: 1, y: 1 },
      },
    });

    const games = new Map<string, GameState>([['game-1', state]]);

    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, next) => games.set(id, next),
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

    // Record Bob's initial position on levelA
    const gameBeforeTransition = games.get('game-1');
    const bobBefore = gameBeforeTransition?.currentLevel?.entities?.find((e: any) => e.kind === 'Player' && e.id === wsB.data.playerEntityId);
    const bobPosBefore = bobBefore?.position;
    if (!bobPosBefore) throw new Error('expected Bob position before transition');

    await hub.message(
      wsA,
      JSON.stringify({
        type: 'action',
        requestId: 't1',
        gameId: 'game-1',
        playerId: playerAId,
        action: { kind: 'Transition' },
      })
    );
    drain(wsA);

    await hub.tickGame('game-1');

    const afterTickA = drain(wsA).find((m) => m.type === 'state');
    const afterTickB = drain(wsB).find((m) => m.type === 'state');
    if (!afterTickA || afterTickA.type !== 'state') throw new Error('expected state broadcast to A');
    if (!afterTickB || afterTickB.type !== 'state') throw new Error('expected state broadcast to B');

    const stateAfter = afterTickA.state as GameState;

    // currentLevelId should now be levelB (follows the transitioning player)
    expect(stateAfter.world.currentLevelId).toBe(levelB.id);
    expect(stateAfter.currentLevel.id).toBe(levelB.id);

    // Only Alice should be on the destination level (currentLevel)
    const destPlayers = stateAfter.currentLevel.entities.filter((e: any) => e.kind === 'Player');
    expect(destPlayers).toHaveLength(1);
    expect(destPlayers[0].id).toBe(wsA.data.playerEntityId);

    // Bob should remain on the source level (stored in world.levels)
    const sourceLevelStored = stateAfter.world.levels[levelAWithPortal.id]?.level;
    const sourcePlayers = sourceLevelStored?.entities?.filter((e: any) => e.kind === 'Player') ?? [];
    expect(sourcePlayers).toHaveLength(1);
    expect(sourcePlayers[0].id).toBe(wsB.data.playerEntityId);

    // playerLocations should track each player's level
    const actorA = wsA.data.playerEntityId!;
    const actorB = wsB.data.playerEntityId!;
    expect(stateAfter.world.playerLocations?.[actorA]?.levelId).toBe(levelB.id);
    // Note: Bob's playerLocations was set when he joined, should still be levelA
  });

  test('multi-level: players on different levels can move independently in the same tick', async () => {
    const levelA = { ...makeLevelWithSize(5, 5), id: 'lvl-a' };
    const tilesA = [...levelA.tiles];
    // Place transition at center (2,2) where first player spawns on a 5x5 level
    tilesA[2 * levelA.width + 2] = 'Transition';
    const levelAWithPortal: LevelState = { ...levelA, tiles: tilesA };

    const levelB = { ...makeLevelWithSize(5, 5), id: 'lvl-b' };
    const state = makeStateWithSecondLevel({
      levelA: levelAWithPortal,
      levelB,
      edge: {
        id: 'edge-a-b',
        fromLevelId: levelAWithPortal.id,
        fromPosition: { x: 2, y: 2 },
        toLevelId: levelB.id,
        toPosition: { x: 2, y: 2 },
      },
    });

    const games = new Map<string, GameState>([['game-1', state]]);

    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, next) => games.set(id, next),
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

    // Both players join on levelA
    await hub.message(wsA, JSON.stringify({ type: 'join', requestId: 'join-a', gameId: 'game-1', playerId: playerAId, playerName: 'Alice' }));
    drain(wsA);
    await hub.message(wsB, JSON.stringify({ type: 'join', requestId: 'join-b', gameId: 'game-1', playerId: playerBId, playerName: 'Bob' }));
    drain(wsB);
    drain(wsA);

    // Alice transitions to levelB
    await hub.message(wsA, JSON.stringify({ type: 'action', requestId: 't1', gameId: 'game-1', playerId: playerAId, action: { kind: 'Transition' } }));
    drain(wsA);
    await hub.tickGame('game-1');
    drain(wsA);
    drain(wsB);

    // Now Alice is on levelB, Bob is on levelA
    // Get their current positions
    const stateAfterTransition = games.get('game-1');
    if (!stateAfterTransition) throw new Error('expected game state');
    const actorA = wsA.data.playerEntityId!;
    const actorB = wsB.data.playerEntityId!;

    const levelBState = stateAfterTransition.world.levels['lvl-b']?.level;
    const levelAState = stateAfterTransition.world.levels['lvl-a']?.level;
    if (!levelBState || !levelAState) throw new Error('expected both levels');

    const aliceBefore = levelBState.entities.find((e: any) => e.id === actorA) as Player | undefined;
    const bobBefore = levelAState.entities.find((e: any) => e.id === actorB) as Player | undefined;
    if (!aliceBefore || !bobBefore) throw new Error('expected both players in their levels');

    // Queue moves for both players (on different levels)
    await hub.message(wsA, JSON.stringify({ type: 'action', requestId: 'm-a', gameId: 'game-1', playerId: playerAId, action: { kind: 'Move', direction: 'Right' } }));
    await hub.message(wsB, JSON.stringify({ type: 'action', requestId: 'm-b', gameId: 'game-1', playerId: playerBId, action: { kind: 'Move', direction: 'Down' } }));
    drain(wsA);
    drain(wsB);

    // Tick - both players should move on their respective levels
    await hub.tickGame('game-1');

    const stateForA = drain(wsA).find((m) => m.type === 'state');
    const stateForB = drain(wsB).find((m) => m.type === 'state');
    if (!stateForA || stateForA.type !== 'state') throw new Error('expected state broadcast to A');
    if (!stateForB || stateForB.type !== 'state') throw new Error('expected state broadcast to B');

    const viewA = stateForA.state as GameState;
    const viewB = stateForB.state as GameState;

    // Alice should have moved Right on levelB
    const aliceAfter = viewA.currentLevel.entities.find((e: any) => e.id === actorA) as Player | undefined;
    if (!aliceAfter) throw new Error('expected Alice in her view');
    expect(aliceAfter.position.x).toBe(aliceBefore.position.x + 1);
    expect(aliceAfter.position.y).toBe(aliceBefore.position.y);

    // Bob should have moved Down on levelA
    const bobAfter = viewB.currentLevel.entities.find((e: any) => e.id === actorB) as Player | undefined;
    if (!bobAfter) throw new Error('expected Bob in his view');
    expect(bobAfter.position.x).toBe(bobBefore.position.x);
    expect(bobAfter.position.y).toBe(bobBefore.position.y + 1);
  });

  test('multi-level: wsHub broadcasts per-player level view when players are on different levels', async () => {
    const levelA = { ...makeLevelWithSize(3, 3), id: 'lvl-a' };
    const tilesA = [...levelA.tiles];
    tilesA[1 * levelA.width + 1] = 'Transition';
    const levelAWithPortal: LevelState = { ...levelA, tiles: tilesA };

    const levelB = { ...makeLevelWithSize(3, 3), id: 'lvl-b' };
    const state = makeStateWithSecondLevel({
      levelA: levelAWithPortal,
      levelB,
      edge: {
        id: 'edge-a-b',
        fromLevelId: levelAWithPortal.id,
        fromPosition: { x: 1, y: 1 },
        toLevelId: levelB.id,
        toPosition: { x: 1, y: 1 },
      },
    });

    const games = new Map<string, GameState>([['game-1', state]]);

    const hub = createWsHub({
      newRequestId: createIdGenerator('req'),
      newGameId: createIdGenerator('game'),
      tickMs: 200,
      startTickTimers: false,
      getGame: (id) => games.get(id),
      setGame: (id, next) => games.set(id, next),
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

    // Both players join
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

    // Alice transitions to levelB
    await hub.message(
      wsA,
      JSON.stringify({
        type: 'action',
        requestId: 't1',
        gameId: 'game-1',
        playerId: playerAId,
        action: { kind: 'Transition' },
      })
    );
    drain(wsA);

    await hub.tickGame('game-1');

    // Get the state broadcasts for each player
    const stateForA = drain(wsA).find((m) => m.type === 'state');
    const stateForB = drain(wsB).find((m) => m.type === 'state');
    if (!stateForA || stateForA.type !== 'state') throw new Error('expected state broadcast to A');
    if (!stateForB || stateForB.type !== 'state') throw new Error('expected state broadcast to B');

    const viewA = stateForA.state as GameState;
    const viewB = stateForB.state as GameState;

    // Alice should see levelB as her currentLevel
    expect(viewA.currentLevel.id).toBe('lvl-b');
    expect(viewA.world.currentLevelId).toBe('lvl-b');
    const aliceOnViewA = viewA.currentLevel.entities.find((e: any) => e.id === wsA.data.playerEntityId);
    expect(aliceOnViewA).toBeDefined();

    // Bob should see levelA as his currentLevel
    expect(viewB.currentLevel.id).toBe('lvl-a');
    expect(viewB.world.currentLevelId).toBe('lvl-a');
    const bobOnViewB = viewB.currentLevel.entities.find((e: any) => e.id === wsB.data.playerEntityId);
    expect(bobOnViewB).toBeDefined();

    // Each player should only see themselves on their respective level
    const playersOnViewA = viewA.currentLevel.entities.filter((e: any) => e.kind === 'Player');
    const playersOnViewB = viewB.currentLevel.entities.filter((e: any) => e.kind === 'Player');
    expect(playersOnViewA).toHaveLength(1);
    expect(playersOnViewB).toHaveLength(1);
  });
});
