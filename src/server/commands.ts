import type { EntityId, GameState, Player, Monster, Item } from '../domain/model.js';
import { addMessage, getPlayerById } from '../engine/game.js';

export type ParsedCommand =
  | { kind: 'Empty' }
  | { kind: 'Help' }
  | { kind: 'Say'; message: string }
  | { kind: 'Look' }
  | { kind: 'Who' }
  | { kind: 'Unknown'; command: string };

function normalizeCommandText(text: string): string {
  return text.trim();
}

export function parseCommandText(text: string): ParsedCommand {
  const trimmed = normalizeCommandText(text);
  if (!trimmed) return { kind: 'Empty' };

  const raw = trimmed.startsWith('/') ? trimmed.slice(1).trim() : trimmed;
  if (!raw) return { kind: 'Empty' };

  const [commandRaw, ...rest] = raw.split(/\s+/);
  const command = commandRaw.toLowerCase();
  const argsText = rest.join(' ').trim();

  switch (command) {
    case 'help':
    case '?':
      return { kind: 'Help' };
    case 'say':
      if (!argsText) return { kind: 'Unknown', command: 'say' };
      return { kind: 'Say', message: argsText };
    case 'look':
      return { kind: 'Look' };
    case 'who':
      return { kind: 'Who' };
    default:
      return { kind: 'Unknown', command };
  }
}

function summarizeCounts(items: string[]): string {
  if (items.length === 0) return 'none';

  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => (count === 1 ? name : `${name} x${count}`))
    .join(', ');
}

function listPlayers(state: GameState): Player[] {
  return state.currentLevel.entities.filter((e): e is Player => e.kind === 'Player');
}

function listMonsters(state: GameState): Monster[] {
  return state.currentLevel.entities.filter((e): e is Monster => e.kind === 'Monster');
}

function listItems(state: GameState): Item[] {
  return state.currentLevel.entities.filter((e): e is Item => e.kind === 'Item');
}

function describeLook(state: GameState, actorId: EntityId): GameState {
  const actorName = getPlayerById(state, actorId)?.name ?? 'Someone';
  const base = state.roomDescription ?? `${actorName} looks around.`;
  let next = addMessage(state, base, 'system');

  const players = listPlayers(state).map((p) => p.name);
  const monsters = listMonsters(state).map((m) => state.enemyFlavors[m.templateId]?.name ?? 'Enemy');
  const items = listItems(state).map((i) => i.name);

  const roster = `Players: ${summarizeCounts(players)}. Hostiles: ${summarizeCounts(monsters)}. Items: ${summarizeCounts(items)}.`;
  next = addMessage(next, roster, 'system');
  return next;
}

function describeWho(state: GameState): GameState {
  const players = listPlayers(state).map((p) => p.name);
  return addMessage(state, `Players here: ${summarizeCounts(players)}.`, 'system');
}

function describeHelp(state: GameState): GameState {
  return addMessage(state, 'Commands: /say <msg>, /look, /who', 'system');
}

function describeUnknown(state: GameState, command: string): GameState {
  if (command === 'say') return addMessage(state, 'Usage: /say <message>', 'system');
  return addMessage(state, `Unknown command: /${command}. Try /say, /look, /who`, 'system');
}

export function applyCommand(state: GameState, text: string): GameState {
  return applyCommandForActor(state, state.playerId, text);
}

export function applyCommandForActor(state: GameState, actorId: EntityId, text: string): GameState {
  const parsed = parseCommandText(text);
  switch (parsed.kind) {
    case 'Empty':
      return addMessage(state, 'No command entered.', 'system');
    case 'Help':
      return describeHelp(state);
    case 'Say':
      return addMessage(state, `${getPlayerById(state, actorId)?.name ?? 'Someone'}: ${parsed.message}`, 'chat');
    case 'Look':
      return describeLook(state, actorId);
    case 'Who':
      return describeWho(state);
    case 'Unknown':
      return describeUnknown(state, parsed.command);
  }
}
