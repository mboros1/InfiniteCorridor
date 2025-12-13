import { describe, expect, test } from 'bun:test';
import { createServer } from '../index.js';
import { WsServerMessageSchema } from '../../protocol/ws.js';

function pickPort(): number {
  return Math.floor(40_000 + Math.random() * 20_000);
}

function startTestServer(): ReturnType<typeof createServer> {
  try {
    // Prefer an ephemeral port to avoid conflicts in parallel test runs.
    return createServer({ port: 0, startTickTimers: false, useMockAi: true });
  } catch {
    // Fall back to random ports for environments that don't support port 0.
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = pickPort();
    try {
      return createServer({ port, startTickTimers: false, useMockAi: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to start test server');
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket open timeout')), 2_000);
    ws.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('WebSocket error'));
    };
  });
}

function decodeWsData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return String(data);
}

function createMessageQueue(ws: WebSocket) {
  const queue: unknown[] = [];
  const waiters: Array<(msg: unknown) => void> = [];

  ws.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeWsData(event.data));
    } catch {
      return;
    }

    const waiter = waiters.shift();
    if (waiter) waiter(parsed);
    else queue.push(parsed);
  };

  async function next(timeoutMs = 2_000): Promise<unknown> {
    if (queue.length > 0) return queue.shift();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Message timeout')), timeoutMs);
      waiters.push((msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
    });
  }

  async function nextWhere(predicate: (msg: any) => boolean, timeoutMs = 2_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const remaining = Math.max(0, deadline - Date.now());
      const msg = await next(remaining);
      if (predicate(msg)) return msg;
    }
  }

  return { nextWhere };
}

describe('websocket protocol (smoke)', () => {
  test('startRun -> join -> broadcast state updates', async () => {
    let server: ReturnType<typeof createServer>;
    try {
      server = startTestServer();
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
      if (code === 'EADDRINUSE') {
        // Some sandboxed test environments cannot bind/listen on ports; skip in that case.
        return;
      }
      throw error;
    }

    const wsA = new WebSocket(`ws://localhost:${server.port}/ws`);
    const wsB = new WebSocket(`ws://localhost:${server.port}/ws`);
    await waitForOpen(wsA);
    await waitForOpen(wsB);

    const a = createMessageQueue(wsA);
    const b = createMessageQueue(wsB);

    const startReqId = 't-start';
    wsA.send(
      JSON.stringify({
        type: 'startRun',
        requestId: startReqId,
        playerId: '00000000-0000-0000-0000-000000000001',
        playerName: 'Alice',
        themePrompt: 'test',
        seed: 'seed',
        difficulty: 'Normal',
        rulesVersion: '0.1.0',
      })
    );

    const startRespRaw = await a.nextWhere((m) => m && m.type === 'response' && m.requestId === startReqId);
    const startResp = WsServerMessageSchema.parse(startRespRaw);
    if (startResp.type !== 'response' || !startResp.ok) throw new Error('Expected startRun ok response');
    const gameId = (startResp.data as any)?.gameId as string;
    expect(typeof gameId).toBe('string');
    expect(gameId.startsWith('game-')).toBe(true);

    // creator should receive state broadcast
    const stateAfterStartRaw = await a.nextWhere((m) => m && m.type === 'state' && m.gameId === gameId);
    const stateAfterStart = WsServerMessageSchema.parse(stateAfterStartRaw);
    if (stateAfterStart.type !== 'state') throw new Error('Expected state message');
    expect(stateAfterStart.gameStatus).toBe('active');

    const joinReqId = 't-join';
    wsB.send(
      JSON.stringify({
        type: 'join',
        requestId: joinReqId,
        gameId,
        playerId: '00000000-0000-0000-0000-000000000002',
        playerName: 'Bob',
      })
    );

    const joinRespRaw = await b.nextWhere((m) => m && m.type === 'response' && m.requestId === joinReqId);
    const joinResp = WsServerMessageSchema.parse(joinRespRaw);
    if (joinResp.type !== 'response' || !joinResp.ok) throw new Error('Expected join ok response');

    // both should receive the updated state
    const aAfterJoinRaw = await a.nextWhere((m) => m && m.type === 'state' && m.gameId === gameId);
    const bAfterJoinRaw = await b.nextWhere((m) => m && m.type === 'state' && m.gameId === gameId);
    const aAfterJoin = WsServerMessageSchema.parse(aAfterJoinRaw);
    const bAfterJoin = WsServerMessageSchema.parse(bAfterJoinRaw);
    if (aAfterJoin.type !== 'state' || bAfterJoin.type !== 'state') throw new Error('Expected state after join');

    const playersA = (aAfterJoin.state as any)?.currentLevel?.entities?.filter?.((e: any) => e.kind === 'Player') ?? [];
    expect(playersA.length).toBeGreaterThanOrEqual(2);

    const sayReqId = 't-say';
    wsA.send(
      JSON.stringify({
        type: 'action',
        requestId: sayReqId,
        gameId,
        playerId: '00000000-0000-0000-0000-000000000001',
        playerName: 'Alice',
        action: { kind: 'Command', text: '/say hi' },
      })
    );

    const sayRespRaw = await a.nextWhere((m) => m && m.type === 'response' && m.requestId === sayReqId);
    const sayResp = WsServerMessageSchema.parse(sayRespRaw);
    if (sayResp.type !== 'response' || !sayResp.ok) throw new Error('Expected action ok response');

    const aAfterSayRaw = await a.nextWhere((m) => m && m.type === 'state' && m.gameId === gameId);
    const bAfterSayRaw = await b.nextWhere((m) => m && m.type === 'state' && m.gameId === gameId);
    const aAfterSay = WsServerMessageSchema.parse(aAfterSayRaw);
    const bAfterSay = WsServerMessageSchema.parse(bAfterSayRaw);
    if (aAfterSay.type !== 'state' || bAfterSay.type !== 'state') throw new Error('Expected state after say');

    const messages = (aAfterSay.state as any)?.messages ?? [];
    const lastText = messages[messages.length - 1]?.text;
    expect(lastText).toContain('Alice: hi');

    wsA.close();
    wsB.close();
    server.stop();
  });
});
