import type { EntityId } from './model.js';

export function playerEntityId(playerId: string): EntityId {
  return `p:${playerId}`;
}

