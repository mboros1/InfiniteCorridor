import type {
  EnemyFlavor,
  EnemyTemplate,
  LevelState,
  WorldConfig
} from '../domain/model.js';
import type { TileFlavor, TileKind } from '../domain/tiles.js';

// This file defines the *only* shapes that cross the AI boundary.
// The AI adapter should take deterministic engine state and return flavor data,
// never alter core mechanics.

// Context we pass to AI when generating flavor.
// You can trim or expand this as needed.
export interface AIContext {
  worldConfig: WorldConfig;
  recentNarrativeSummary?: string; // optional short text summarizing recent events.
}

// Request for generating room-level flavor.
// We DO NOT send the whole GameState by default to keep prompts small.
export interface RoomFlavorRequest {
  context: AIContext;
  level: Pick<LevelState, 'depth' | 'width' | 'height'>;
  // Simplified description of what's in the room mechanically:
  // counts, tags, etc. Engine is responsible for computing this.
  enemyTemplates: EnemyTemplate[];
  // Abstract tile types present in this level that need theming
  tileTypesPresent: TileKind[];
  // You might add info about items, exits, etc. later.
}

// Response structure from the AI for a single room.
export interface RoomFlavorResponse {
  roomDescription: string;
  // Flavor keyed by enemy template id, so the engine can attach it.
  enemyFlavors: Record<string, EnemyFlavor>;
  // Themed tile flavors keyed by abstract tile kind
  tileFlavors: Partial<Record<TileKind, TileFlavor>>;
}

export interface PlayerProfileRequest {
  prompt: string;
}

export interface PlayerProfileResponse {
  name: string;
  description: string;
  tokenChar: string;
  tokenColor: string;
}

// Narrow interface that the rest of the code calls.
// Implementation will live in another file (e.g., src/ai/openRouterAdapter.ts),
// but the rest of the system just depends on this contract.
export interface AIAdapter {
  generateRoomFlavor(
    request: RoomFlavorRequest
  ): Promise<RoomFlavorResponse>;

  generatePlayerProfile(
    request: PlayerProfileRequest
  ): Promise<PlayerProfileResponse>;
}
