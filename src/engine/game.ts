import type {
  Action,
  Direction,
  Entity,
  EntityId,
  GameMessage,
  GameState,
  LevelCoord,
  LevelEdge,
  LevelId,
  LevelState,
  Monster,
  Player,
  Position,
  TileKind,
  WorldConfig,
  WorldState
} from '../domain/model.js';
import { isWalkable, isTransparent } from '../domain/tiles.js';
import { CONFIG } from '../config/index.js';
import { debugLog } from '../utils/debug.js';
import { createRNG, hashSeed } from './rng.js';
import { generateLevel, generateLevelId, getDefaultLevelConfig } from './levelgen.js';

// Helper to add a message to the game state (exported for use in server)
export function addMessage(
  state: GameState,
  text: string,
  kind: GameMessage['kind'] = 'info'
): GameState {
  const message: GameMessage = { turn: state.turn, ts: Date.now(), text, kind };
  return { ...state, messages: [...state.messages, message] };
}

// ---- Constants from CONFIG ----

const PLAYER_FOV_RADIUS = CONFIG.gameplay.playerFovRadius;
const MONSTER_DETECTION_RANGE_SQ = CONFIG.gameplay.monsterDetectionRangeSq;

// ---- Leveling & Regen Constants ----

const LEVEL_GROWTH = 1.012;        // 1.2% power increase per level
const REGEN_EVERY_TURNS = 5;       // Heal 1 HP every N turns
const REGEN_AMOUNT = 1;
const XP_BASE = 25;                // xpToNext = XP_BASE * level (linear)
const STAT_LEVEL_INTERVAL = 3;     // +1 to STR/AGI/INT every N levels

// ---- Utility helpers ----

export function directionToDelta(direction: Direction): Position {
  switch (direction) {
    case 'Up':
      return { x: 0, y: -1 };
    case 'Down':
      return { x: 0, y: 1 };
    case 'Left':
      return { x: -1, y: 0 };
    case 'Right':
      return { x: 1, y: 0 };
    default: {
      const _exhaustive: never = direction;
      return _exhaustive;
    }
  }
}

export function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

export function getTile(level: LevelState, x: number, y: number): TileKind | null {
  if (!inBounds(x, y, level.width, level.height)) return null;
  return level.tiles[y * level.width + x];
}

// Note: isWalkable and isTransparent are imported from '../domain/tiles.js'

export function getEntityAt(level: LevelState, x: number, y: number): Entity | undefined {
  return level.entities.find((e) => e.position.x === x && e.position.y === y);
}

export function getPlayerById(state: GameState, playerId: EntityId): Player | undefined {
  const entity = state.currentLevel.entities.find((e) => e.id === playerId);
  return entity?.kind === 'Player' ? entity : undefined;
}

export function listPlayers(state: GameState): Player[] {
  return state.currentLevel.entities.filter((e): e is Player => e.kind === 'Player');
}

export function getPlayer(state: GameState): Player | undefined {
  return getPlayerById(state, state.playerId);
}

// ---- Leveling & XP Helpers ----

function xpToNextLevel(level: number): number {
  return XP_BASE * level;
}

/**
 * Apply level-up effects: scale maxHp, heal to full, bump stats every N levels.
 * Returns updated player and count of levels gained.
 */
function applyLevelUp(player: Player): { player: Player; levelsGained: number } {
  let p = { ...player };
  let levelsGained = 0;

  while (p.xp >= p.xpToNext) {
    p.xp -= p.xpToNext;
    p.level += 1;
    levelsGained += 1;

    // Scale maxHp by LEVEL_GROWTH, heal to full
    p.maxHp = Math.ceil(p.maxHp * LEVEL_GROWTH);
    p.hp = p.maxHp;

    // Bump stats every STAT_LEVEL_INTERVAL levels
    if (p.level % STAT_LEVEL_INTERVAL === 0) {
      p.strength += 1;
      p.agility += 1;
      p.intellect += 1;
    }

    // Update next threshold
    p.xpToNext = xpToNextLevel(p.level);
  }

  return { player: p, levelsGained };
}

/**
 * Award XP to a player and process any level-ups.
 * Returns updated game state with messages.
 */
function awardXp(state: GameState, playerId: EntityId, amount: number): GameState {
  const level = state.currentLevel;
  const playerIdx = level.entities.findIndex((e) => e.id === playerId && e.kind === 'Player');
  if (playerIdx === -1) return state;

  const player = level.entities[playerIdx] as Player;
  const updatedPlayer = { ...player, xp: player.xp + amount };

  const { player: finalPlayer, levelsGained } = applyLevelUp(updatedPlayer);

  const updatedEntities = [...level.entities];
  updatedEntities[playerIdx] = finalPlayer;

  let resultState: GameState = {
    ...state,
    currentLevel: { ...level, entities: updatedEntities },
  };

  resultState = addMessage(resultState, `${player.name} gains ${amount} XP.`, 'info');

  for (let i = 0; i < levelsGained; i++) {
    const newLevel = player.level + i + 1;
    resultState = addMessage(resultState, `${player.name} reached level ${newLevel}!`, 'level');
  }

  return resultState;
}

/**
 * Apply passive HP regen if conditions are met.
 */
function applyRegen(state: GameState): GameState {
  // Only regen on turns divisible by REGEN_EVERY_TURNS
  if ((state.turn + 1) % REGEN_EVERY_TURNS !== 0) return state;

  const level = state.currentLevel;
  let changed = false;
  const entities = level.entities.map((e) => {
    if (e.kind !== 'Player') return e;
    if (e.hp <= 0 || e.hp >= e.maxHp) return e;
    changed = true;
    return { ...e, hp: Math.min(e.maxHp, e.hp + REGEN_AMOUNT) };
  });

  if (!changed) return state;
  return {
    ...state,
    currentLevel: { ...level, entities },
  };
}

// Field of view: simple raycasting to discover tiles
export function updateFov(level: LevelState, playerPos: Position, radius: number): LevelState {
  const discovered = [...level.discovered];

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = playerPos.x + dx;
      const y = playerPos.y + dy;

      if (!inBounds(x, y, level.width, level.height)) continue;
      if (dx * dx + dy * dy > radius * radius) continue;

      // Simple LOS check: walk from player to target
      let blocked = false;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));

      if (steps > 0) {
        for (let i = 1; i < steps; i++) {
          const checkX = Math.round(playerPos.x + (dx * i) / steps);
          const checkY = Math.round(playerPos.y + (dy * i) / steps);
          const tile = getTile(level, checkX, checkY);
          if (!isTransparent(tile)) {
            blocked = true;
            break;
          }
        }
      }

      if (!blocked) {
        discovered[y * level.width + x] = true;
      }
    }
  }

  return { ...level, discovered };
}

// ---- Game initialization ----

export function createInitialGameState(config: WorldConfig): GameState {
  debugLog('[DEBUG] createInitialGameState: starting');
  const seed = hashSeed(config.seed);
  const rng = createRNG(seed);
  debugLog('[DEBUG] createInitialGameState: seed hashed');

  // Starting level is at origin (0, 0)
  const startCoord: LevelCoord = { x: 0, y: 0 };
  const levelId = generateLevelId(seed, startCoord);
  debugLog('[DEBUG] createInitialGameState: levelId generated:', levelId);

  const levelConfig = getDefaultLevelConfig(1, config.difficulty);
  debugLog('[DEBUG] createInitialGameState: calling generateLevel');
  const { level, transitionPositions } = generateLevel(rng, levelConfig);
  debugLog('[DEBUG] createInitialGameState: level generated, transitions:', transitionPositions.length);

  // Set proper level ID
  level.id = levelId;

  // Find the player entity
  const player = level.entities.find((e) => e.kind === 'Player');
  if (!player) throw new Error('Level generation failed: no player');
  debugLog('[DEBUG] createInitialGameState: player found');

  // Update FOV from player starting position
  const levelWithFov = updateFov(level, player.position, PLAYER_FOV_RADIUS);
  debugLog('[DEBUG] createInitialGameState: FOV updated');

  // Create edges for transitions to adjacent levels
  const edges = createEdgesForLevel(levelId, startCoord, transitionPositions, seed, levelWithFov.width, levelWithFov.height);
  debugLog('[DEBUG] createInitialGameState: edges created:', edges.length);

  // Initialize world state
  const world: WorldState = {
    levels: {
      [levelId]: {
        level: levelWithFov,
        coord: startCoord,
        compressedAt: 0,
      },
    },
    edges,
    currentLevelId: levelId,
  };

  return {
    worldConfig: config,
    seed,
    world,
    currentLevel: levelWithFov,
    playerId: player.id,
    turn: 0,
    messages: [{ turn: 0, ts: Date.now(), text: 'You step through the portal...', kind: 'system' }],
    enemyFlavors: {},
    tileFlavors: {},
    roomDescription: undefined,
  };
}

// ---- Edge Creation ----

/**
 * Create edges from a level's transition tiles to adjacent levels.
 * Each transition at a map edge leads to the corresponding adjacent level.
 */
function createEdgesForLevel(
  levelId: string,
  coord: LevelCoord,
  transitionPositions: Position[],
  seed: number,
  levelWidth: number,
  levelHeight: number
): LevelEdge[] {
  const edges: LevelEdge[] = [];

  for (let i = 0; i < transitionPositions.length; i++) {
    const pos = transitionPositions[i];

    // Determine which edge this transition is on and calculate target level coord
    let targetCoord: LevelCoord;
    let spawnPosition: Position;

    if (pos.x <= 2) {
      // Left edge → level to the west
      targetCoord = { x: coord.x - 1, y: coord.y };
      spawnPosition = { x: levelWidth - 3, y: pos.y };  // Spawn on right side of target
    } else if (pos.x >= levelWidth - 3) {
      // Right edge → level to the east
      targetCoord = { x: coord.x + 1, y: coord.y };
      spawnPosition = { x: 2, y: pos.y };  // Spawn on left side of target
    } else if (pos.y <= 2) {
      // Top edge → level to the north
      targetCoord = { x: coord.x, y: coord.y - 1 };
      spawnPosition = { x: pos.x, y: levelHeight - 3 };  // Spawn on bottom of target
    } else {
      // Bottom edge → level to the south
      targetCoord = { x: coord.x, y: coord.y + 1 };
      spawnPosition = { x: pos.x, y: 2 };  // Spawn on top of target
    }

    const targetLevelId = generateLevelId(seed, targetCoord);

    edges.push({
      id: `edge-${levelId}-${i}`,
      fromLevelId: levelId,
      fromPosition: pos,
      toLevelId: targetLevelId,
      toPosition: spawnPosition,
    });
  }

  return edges;
}

// ---- Level Transitions ----

/**
 * Result of a transition attempt.
 * Includes a flag indicating if a new level was generated (for AI flavor).
 */
export interface TransitionResult {
  state: GameState;
  isNewLevel: boolean;
  newLevelId?: string;
}

/**
 * Handle player using a transition tile to move to another level.
 * Returns updated state and whether a new level was generated.
 */
export function handleTransition(state: GameState, actorId: EntityId = state.playerId): TransitionResult {
  const actor = getPlayerById(state, actorId);
  if (!actor) return { state, isNewLevel: false };
  const party = listPlayers(state);
  if (party.length === 0) return { state, isNewLevel: false };

  // Check if player is standing on a transition tile
  const tile = getTile(state.currentLevel, actor.position.x, actor.position.y);
  if (tile !== 'Transition') {
    return {
      state: addMessage(state, 'There is no passage here.', 'system'),
      isNewLevel: false,
    };
  }

  // Find the edge from this position
  const forwardEdge = state.world.edges.find(
    (e) =>
      e.fromLevelId === state.world.currentLevelId &&
      e.fromPosition.x === actor.position.x &&
      e.fromPosition.y === actor.position.y
  );

  if (!forwardEdge) {
    return {
      state: addMessage(state, 'This passage leads nowhere.', 'system'),
      isNewLevel: false,
    };
  }

  // Store current level state with compression timestamp
  const updatedLevels = {
    ...state.world.levels,
    [state.world.currentLevelId]: {
      ...state.world.levels[state.world.currentLevelId],
      level: removePlayersFromLevel(state.currentLevel),
      compressedAt: state.turn,
      tileFlavors: state.tileFlavors,
      enemyFlavors: state.enemyFlavors,
      roomDescription: state.roomDescription,
    },
  };

  let destLevel: LevelState;
  let newEdges = state.world.edges;
  let isNewLevel = false;
  const entryPos: Position = { ...forwardEdge.toPosition };

  // Check if destination level exists
  if (updatedLevels[forwardEdge.toLevelId]) {
    // Level exists - restore it
    destLevel = updatedLevels[forwardEdge.toLevelId].level;
  } else {
    // Generate new level
    isNewLevel = true;

    // Parse target coord from level ID or calculate from edge
    const targetCoord = getCoordForLevelId(forwardEdge.toLevelId, state.world);
    if (!targetCoord) {
      return {
        state: addMessage(state, 'Cannot determine destination.', 'system'),
        isNewLevel: false,
      };
    }

    // Calculate depth based on distance from origin
    const depth = Math.abs(targetCoord.x) + Math.abs(targetCoord.y) + 1;

    // Create RNG seeded from target level ID for reproducibility
    const levelSeed = hashSeed(forwardEdge.toLevelId);
    const rng = createRNG(levelSeed);

    const levelConfig = getDefaultLevelConfig(depth, state.worldConfig.difficulty);
    const { level, transitionPositions } = generateLevel(rng, levelConfig);

    let generatedLevel: LevelState = {
      ...level,
      id: forwardEdge.toLevelId,
      depth,
    };

    // Create edges for new level's transitions
    const levelEdges = createEdgesForLevel(
      forwardEdge.toLevelId,
      targetCoord,
      transitionPositions,
      state.seed,
      generatedLevel.width,
      generatedLevel.height
    );
    newEdges = [...newEdges, ...levelEdges];

    // Ensure there is a portal back to the source level at the entry point
    generatedLevel = ensureTransitionTile(generatedLevel, entryPos);
    newEdges = addBackEdgeIfMissing(
      newEdges,
      forwardEdge.toLevelId,
      entryPos,
      forwardEdge.fromLevelId,
      forwardEdge.fromPosition
    );

    destLevel = generatedLevel;

    // Store new level
    updatedLevels[forwardEdge.toLevelId] = {
      level: destLevel,
      coord: targetCoord,
      compressedAt: 0,
    };
  }

  // For existing levels, guarantee a return edge and portal at the entry point
  if (!isNewLevel) {
    destLevel = ensureTransitionTile(destLevel, entryPos);
    newEdges = addBackEdgeIfMissing(
      newEdges,
      forwardEdge.toLevelId,
      entryPos,
      forwardEdge.fromLevelId,
      forwardEdge.fromPosition
    );

  }

  // Place party at entry point (spread to nearby walkable tiles) and update FOV.
  destLevel = removePlayersFromLevel(destLevel);
  const placed = placePartyAtEntry(destLevel, entryPos, party, actor.id);
  destLevel = placed.level;

  const destStored = updatedLevels[forwardEdge.toLevelId];
  const destTileFlavors = destStored?.tileFlavors ?? {};
  const destEnemyFlavors = destStored?.enemyFlavors ?? {};
  const destRoomDescription = destStored?.roomDescription;

  // Update stored level
  updatedLevels[forwardEdge.toLevelId] = {
    ...updatedLevels[forwardEdge.toLevelId],
    level: destLevel,
    tileFlavors: destTileFlavors,
    enemyFlavors: destEnemyFlavors,
    roomDescription: destRoomDescription,
  };

  const newState: GameState = {
    ...state,
    world: {
      levels: updatedLevels,
      edges: newEdges,
      currentLevelId: forwardEdge.toLevelId,
    },
    currentLevel: destLevel,
    tileFlavors: destTileFlavors,
    enemyFlavors: destEnemyFlavors,
    roomDescription: destRoomDescription,
    messages: [
      ...state.messages,
      { turn: state.turn, ts: Date.now(), text: 'The party traverses to a new area...', kind: 'system' },
    ],
  };

  return {
    state: newState,
    isNewLevel,
    newLevelId: isNewLevel ? forwardEdge.toLevelId : undefined,
  };
}

/**
 * Ensure a reverse edge exists and return updated edges.
 */
function addBackEdgeIfMissing(
  edges: LevelEdge[],
  fromLevelId: LevelId,
  fromPosition: Position,
  toLevelId: LevelId,
  toPosition: Position
): LevelEdge[] {
  const exists = edges.some(
    (e) =>
      e.fromLevelId === fromLevelId &&
      e.toLevelId === toLevelId &&
      e.fromPosition.x === fromPosition.x &&
      e.fromPosition.y === fromPosition.y
  );

  if (exists) return edges;

  const edgeId = `edge-${fromLevelId}-to-${toLevelId}-x${fromPosition.x}y${fromPosition.y}`;
  return [
    ...edges,
    {
      id: edgeId,
      fromLevelId,
      fromPosition,
      toLevelId,
      toPosition,
    },
  ];
}

/**
 * Guarantee a transition tile exists at the given position.
 */
function ensureTransitionTile(level: LevelState, pos: Position): LevelState {
  if (!inBounds(pos.x, pos.y, level.width, level.height)) return level;

  const idx = pos.y * level.width + pos.x;
  if (level.tiles[idx] === 'Transition') return level;

  const tiles = [...level.tiles];
  tiles[idx] = 'Transition';
  return { ...level, tiles };
}

function removePlayersFromLevel(level: LevelState): LevelState {
  return {
    ...level,
    entities: level.entities.filter((e) => e.kind !== 'Player'),
  };
}

/**
 * Get coordinates for a level ID by parsing or looking up in world state.
 */
function getCoordForLevelId(levelId: string, world: WorldState): LevelCoord | null {
  // Check if level exists in world
  if (world.levels[levelId]) {
    return world.levels[levelId].coord;
  }

  // Parse from level ID format: "level-{seedHash}-{x},{y}"
  const match = levelId.match(/^level-[0-9a-f]+-(-?\d+),(-?\d+)$/);
  if (match) {
    return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
  }

  return null;
}

// ---- Combat ----

function calculateDamage(attacker: Player | Monster, _defender: Player | Monster): number {
  if (attacker.kind === 'Player') {
    return Math.max(1, attacker.strength - 5);
  }
  // Monster attacking player: base damage scales with their HP
  return Math.max(1, Math.floor(attacker.maxHp / 3));
}

function applyDamage<T extends Player | Monster>(entity: T, damage: number): T {
  return { ...entity, hp: Math.max(0, entity.hp - damage) };
}

// ---- Shared attack resolution ----

function resolveAttack(
  state: GameState,
  attackerId: EntityId,
  direction: Direction
): GameState {
  const level = state.currentLevel;
  const attacker = level.entities.find((e) => e.id === attackerId);

  if (!attacker || (attacker.kind !== 'Player' && attacker.kind !== 'Monster')) {
    return state;
  }

  const delta = directionToDelta(direction);
  const targetX = attacker.position.x + delta.x;
  const targetY = attacker.position.y + delta.y;

  const target = getEntityAt(level, targetX, targetY);
  if (!target || (target.kind !== 'Player' && target.kind !== 'Monster')) {
    return state;
  }

  const damage = calculateDamage(attacker, target);
  const damagedTarget = applyDamage(target, damage);

  const updatedEntities = [...level.entities];
  const targetIndex = updatedEntities.findIndex((e) => e.id === target.id);

  let resultState = state;
  if (damagedTarget.hp <= 0) {
    // Target dies: remove from entities
    updatedEntities.splice(targetIndex, 1);
    const deathMessage = target.kind === 'Player'
      ? `${getEntityName(target, state)} has been defeated.`
      : `${getEntityName(target, state)} dies.`;
    resultState = addMessage(resultState, deathMessage, 'combat');

    // Award XP when player kills a monster
    if (attacker.kind === 'Player' && target.kind === 'Monster') {
      const xpGained = target.maxHp;
      const updatedLevel: LevelState = { ...resultState.currentLevel, entities: updatedEntities };
      resultState = { ...resultState, currentLevel: updatedLevel };
      resultState = awardXp(resultState, attacker.id, xpGained);
      // Return early since we already updated the level
      return resultState;
    }
  } else {
    updatedEntities[targetIndex] = damagedTarget;
    const hitMessage = `${getEntityName(attacker, state)} hits ${getEntityName(target, state)} for ${damage} damage.`;
    resultState = addMessage(resultState, hitMessage, 'combat');
  }

  const updatedLevel: LevelState = { ...level, entities: updatedEntities };
  return { ...resultState, currentLevel: updatedLevel };
}

// Helper to get display name for an entity using AI-generated names
function getEntityName(entity: Player | Monster, state: GameState): string {
  if (entity.kind === 'Player') return entity.name;

  // Use AI-generated enemy flavor name if available
  const flavor = state.enemyFlavors[entity.templateId];
  if (flavor?.name) return flavor.name;

  // Fallback to generic name based on template
  if (entity.templateId.includes('boss')) return 'Boss';
  if (entity.templateId.includes('elite')) return 'Elite Enemy';
  return 'Enemy';
}

// ---- Core loop: apply a player action ----

export type ActorIntent = {
  actorId: EntityId;
  action: Action;
};

export type TickResult = {
  state: GameState;
  transition?: TransitionResult;
};

function applyActionWithoutAdvancingTurn(state: GameState, actorId: EntityId, action: Action): TickResult {
  switch (action.kind) {
    case 'Wait':
      return { state };

    case 'Move': {
      const delta = directionToDelta(action.direction);
      const level = state.currentLevel;
      const actorIndex = level.entities.findIndex((e) => e.id === actorId);

      if (actorIndex === -1) return { state };

      const actor = level.entities[actorIndex];
      const targetX = actor.position.x + delta.x;
      const targetY = actor.position.y + delta.y;

      // Check bounds and tile walkability
      const targetTile = getTile(level, targetX, targetY);
      if (!isWalkable(targetTile)) {
        return { state };
      }

      // Check for entity collision
      const entityAtTarget = getEntityAt(level, targetX, targetY);
      if (entityAtTarget) {
        // If it's an enemy and we're the player, auto-attack
        if (actor.kind === 'Player' && entityAtTarget.kind === 'Monster') {
          return applyActionWithoutAdvancingTurn(state, actorId, { kind: 'Attack', direction: action.direction });
        }
        return { state };
      }

      // Move the actor
      const updatedActor: Entity = { ...actor, position: { x: targetX, y: targetY } };
      const updatedEntities = [...level.entities];
      updatedEntities[actorIndex] = updatedActor;

      let updatedLevel: LevelState = { ...level, entities: updatedEntities };

      // Update FOV if player moved
      if (actor.kind === 'Player') {
        updatedLevel = updateFov(updatedLevel, { x: targetX, y: targetY }, PLAYER_FOV_RADIUS);
      }

      return { state: { ...state, currentLevel: updatedLevel } };
    }

    case 'Attack': {
      return { state: resolveAttack(state, actorId, action.direction) };
    }

    case 'Transition': {
      const transition = handleTransition(state, actorId);
      return { state: transition.state, transition };
    }

    case 'Command':
      return { state };
  }
}

export function applyTick(state: GameState, intents: ActorIntent[]): TickResult {
  const orderedIntents = [...intents].sort((a, b) => a.actorId.localeCompare(b.actorId));
  let currentState = state;
  let transition: TransitionResult | undefined = undefined;

  for (const intent of orderedIntents) {
    // Commands are out-of-band (server handles them), so skip here.
    if (intent.action.kind === 'Command') continue;

    const beforeLevelId = currentState.world.currentLevelId;
    const result = applyActionWithoutAdvancingTurn(currentState, intent.actorId, intent.action);
    currentState = result.state;
    if (result.transition) transition = result.transition;

    // Party transition moves everyone; drop any remaining intents for this tick.
    if (intent.action.kind === 'Transition' && currentState.world.currentLevelId !== beforeLevelId) {
      break;
    }
  }

  currentState = applyMonsterActions(currentState);
  currentState = applyRegen(currentState);
  currentState = { ...currentState, turn: currentState.turn + 1 };

  return { state: currentState, transition };
}

export function applyAction(
  state: GameState,
  actorId: EntityId,
  action: Action
): GameState {
  if (action.kind === 'Command') return state;
  return applyTick(state, [{ actorId, action }]).state;
}

// ---- Enemy AI (simple) ----

function moveTowardsPlayer(
  monster: Monster,
  playerPos: Position,
  level: LevelState
): Action {
  const dx = playerPos.x - monster.position.x;
  const dy = playerPos.y - monster.position.y;

  // Simple: prefer larger axis
  let direction: Direction;
  if (Math.abs(dx) > Math.abs(dy)) {
    direction = dx > 0 ? 'Right' : 'Left';
  } else if (dy !== 0) {
    direction = dy > 0 ? 'Down' : 'Up';
  } else {
    return { kind: 'Wait' };
  }

  // Check if we can move that way
  const delta = directionToDelta(direction);
  const targetX = monster.position.x + delta.x;
  const targetY = monster.position.y + delta.y;

  const tile = getTile(level, targetX, targetY);
  if (!isWalkable(tile)) {
    return { kind: 'Wait' };
  }

  // Check if player is adjacent (attack instead)
  if (targetX === playerPos.x && targetY === playerPos.y) {
    return { kind: 'Attack', direction };
  }

  // Check if another entity blocks
  const blocking = getEntityAt(level, targetX, targetY);
  if (blocking) {
    return { kind: 'Wait' };
  }

  return { kind: 'Move', direction };
}

// ---- Turn advancement with enemy actions ----

function applyMonsterActions(state: GameState): GameState {
  const players = listPlayers(state);
  if (players.length === 0) return state;

  let currentState = state;

  // Collect monster IDs upfront to avoid stale snapshot iteration
  const monsterIds = state.currentLevel.entities
    .filter((e) => e.kind === 'Monster')
    .map((e) => e.id);

  // Process each monster's action using fresh state for each decision
  for (const monsterId of monsterIds) {
    const level = currentState.currentLevel;
    const entity = level.entities.find((e) => e.id === monsterId);

    // Monster may have died earlier this turn
    if (!entity || entity.kind !== 'Monster') continue;

    const currentPlayers = listPlayers(currentState);
    if (currentPlayers.length === 0) continue;

    const closest = findClosestPlayer(entity.position, currentPlayers);
    if (!closest) continue;
    if (closest.dist2 > MONSTER_DETECTION_RANGE_SQ) continue;

    // Get monster's action using current game state
    const action = moveTowardsPlayer(entity, closest.player.position, level);

    // Apply the action using resolveAttack or direct movement
    if (action.kind === 'Move') {
      const delta = directionToDelta(action.direction);
      const targetX = entity.position.x + delta.x;
      const targetY = entity.position.y + delta.y;

      const tile = getTile(level, targetX, targetY);
      const blocking = getEntityAt(level, targetX, targetY);

      if (isWalkable(tile) && !blocking) {
        const updatedMonster: Monster = { ...entity, position: { x: targetX, y: targetY } };
        const updatedEntities = [...level.entities];
        const monsterIndex = updatedEntities.findIndex((e) => e.id === monsterId);
        if (monsterIndex !== -1) {
          updatedEntities[monsterIndex] = updatedMonster;
          currentState = { ...currentState, currentLevel: { ...level, entities: updatedEntities } };
        }
      }
    } else if (action.kind === 'Attack') {
      // Use shared attack resolution
      currentState = resolveAttack(currentState, monsterId, action.direction);
    }
  }

  return currentState;
}

function findClosestPlayer(from: Position, players: Player[]): { player: Player; dist2: number } | null {
  let best: { player: Player; dist2: number } | null = null;
  for (const player of players) {
    const dx = from.x - player.position.x;
    const dy = from.y - player.position.y;
    const dist2 = dx * dx + dy * dy;
    if (!best || dist2 < best.dist2) best = { player, dist2 };
  }
  return best;
}

// ---- Query functions ----

export function isGameOver(state: GameState): boolean {
  return listPlayers(state).length === 0;
}

function placePartyAtEntry(
  level: LevelState,
  entryPos: Position,
  party: Player[],
  actorId: EntityId
): { level: LevelState } {
  const reserved = new Set<string>();
  const reservedKey = (p: Position) => `${p.x},${p.y}`;

  const ordered = [
    ...party.filter((p) => p.id === actorId),
    ...party.filter((p) => p.id !== actorId),
  ];

  let currentLevel = level;
  for (const player of ordered) {
    const spawnPos = findNearestSpawn(currentLevel, entryPos, reserved);
    const finalPos = spawnPos ?? entryPos;
    reserved.add(reservedKey(finalPos));

    const updatedPlayer: Player = { ...player, position: finalPos };
    currentLevel = {
      ...currentLevel,
      entities: [...currentLevel.entities, updatedPlayer],
    };
    currentLevel = updateFov(currentLevel, finalPos, PLAYER_FOV_RADIUS);
  }

  return { level: currentLevel };
}

function findNearestSpawn(level: LevelState, start: Position, reserved: Set<string>): Position | null {
  const key = (p: Position) => `${p.x},${p.y}`;
  const startKey = key(start);
  const queue: Position[] = [start];
  const visited = new Set<string>([startKey]);

  const deltas: Position[] = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    if (!reserved.has(key(current))) {
      const tile = getTile(level, current.x, current.y);
      if (isWalkable(tile) && !getEntityAt(level, current.x, current.y)) return current;
    }

    for (const delta of deltas) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      if (!inBounds(next.x, next.y, level.width, level.height)) continue;
      const nextKey = key(next);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      queue.push(next);
    }
  }

  return null;
}

export function getVisibleEntities(state: GameState): Entity[] {
  const level = state.currentLevel;
  return level.entities.filter((e) => {
    const idx = e.position.y * level.width + e.position.x;
    return level.discovered[idx];
  });
}
