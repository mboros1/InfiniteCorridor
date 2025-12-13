import { expect, test } from 'bun:test';
import { createInitialGameState, handleTransition, getPlayer, updateFov } from '../game.js';
import { CONFIG } from '../../config/index.js';

function placePlayerAtFirstEdge(state = createInitialGameState({
  themePrompt: 'test',
  seed: 'seed',
  difficulty: 'Normal',
  rulesVersion: '0.1.0',
})) {
  const edge = state.world.edges[0];
  if (!edge) throw new Error('No edge found in generated level');

  const player = getPlayer(state);
  if (!player) throw new Error('No player found');

  const playerAtEdge = { ...player, position: edge.fromPosition };
  const levelWithPlayer = {
    ...state.currentLevel,
    entities: state.currentLevel.entities.map((e) => e.id === player.id ? playerAtEdge : e),
  };

  const updatedLevels = {
    ...state.world.levels,
    [state.world.currentLevelId]: {
      ...state.world.levels[state.world.currentLevelId],
      level: levelWithPlayer,
    },
  };

  const stateAtEdge = {
    ...state,
    currentLevel: updateFov(levelWithPlayer, playerAtEdge.position, CONFIG.gameplay.playerFovRadius),
    world: { ...state.world, levels: updatedLevels },
  };

  return { edge, stateAtEdge };
}

test('transition returns to same coordinates when going back', () => {
  const { edge, stateAtEdge } = placePlayerAtFirstEdge();

  const forward = handleTransition(stateAtEdge);
  const back = handleTransition(forward.state);

  const playerBack = getPlayer(back.state);
  expect(back.state.world.currentLevelId).toBe(stateAtEdge.world.currentLevelId);
  expect(playerBack?.position).toEqual(edge.fromPosition);
});

test('per-level flavor is restored when revisiting', () => {
  const { edge, stateAtEdge } = placePlayerAtFirstEdge();
  const forward = handleTransition(stateAtEdge);

  const flavoredState: typeof forward.state = {
    ...forward.state,
    tileFlavors: {
      Transition: { name: 'Portal', char: '@', fg: '#f00' },
    },
    enemyFlavors: {
      demo: { name: 'Sentinel', shortDescription: 'A watcher' },
    },
    roomDescription: 'Fiery gateway',
    world: {
      ...forward.state.world,
      levels: {
        ...forward.state.world.levels,
        [forward.state.world.currentLevelId]: {
          ...forward.state.world.levels[forward.state.world.currentLevelId],
          tileFlavors: {
            Transition: { name: 'Portal', char: '@', fg: '#f00' },
          },
          enemyFlavors: {
            demo: { name: 'Sentinel', shortDescription: 'A watcher' },
          },
          roomDescription: 'Fiery gateway',
        },
      },
    },
  };

  const back = handleTransition(flavoredState);
  const again = handleTransition(back.state);

  expect(again.state.tileFlavors).toEqual(flavoredState.tileFlavors);
  expect(again.state.enemyFlavors).toEqual(flavoredState.enemyFlavors);
  expect(again.state.roomDescription).toBe('Fiery gateway');
  const playerAgain = getPlayer(again.state);
  expect(playerAgain?.position).toEqual(edge.toPosition);
});

// Additional tests for game engine functionality
test('createInitialGameState creates valid game state', () => {
  const state = createInitialGameState({
    themePrompt: 'test world',
    seed: 'test-seed',
    difficulty: 'Normal',
    rulesVersion: '0.1.0',
  });

  expect(state).toBeDefined();
  expect(state.worldConfig.themePrompt).toBe('test world');
  expect(state.worldConfig.seed).toBe('test-seed');
  expect(state.turn).toBe(0);
  expect(state.messages).toHaveLength(1);
  expect(state.currentLevel).toBeDefined();
  expect(state.currentLevel.width).toBe(CONFIG.level.width);
  expect(state.currentLevel.height).toBe(CONFIG.level.height);
});

test('getPlayer returns player entity', () => {
  const state = createInitialGameState({
    themePrompt: 'test',
    seed: 'seed',
    difficulty: 'Normal',
    rulesVersion: '0.1.0',
  });

  const player = getPlayer(state);
  expect(player).toBeDefined();
  expect(player?.kind).toBe('Player');
  expect(player?.hp).toBeGreaterThan(0);
});

test('updateFov updates discovered tiles', () => {
  const state = createInitialGameState({
    themePrompt: 'test',
    seed: 'seed',
    difficulty: 'Normal',
    rulesVersion: '0.1.0',
  });

  const player = getPlayer(state);
  if (!player) throw new Error('Player not found');

  const levelWithFov = updateFov(state.currentLevel, player.position, CONFIG.gameplay.playerFovRadius);
  
  // Should have some discovered tiles around player
  const discoveredCount = levelWithFov.discovered.filter(Boolean).length;
  expect(discoveredCount).toBeGreaterThan(0);
  expect(discoveredCount).toBeLessThanOrEqual(levelWithFov.width * levelWithFov.height);
});

test('handleTransition with invalid position returns error message', () => {
  const state = createInitialGameState({
    themePrompt: 'test',
    seed: 'seed',
    difficulty: 'Normal',
    rulesVersion: '0.1.0',
  });

  // Create a state where player is not on a transition tile
  const player = getPlayer(state);
  if (!player) throw new Error('Player not found');

  // Move player to a non-transition tile (assuming most tiles are not transitions)
  const nonTransitionState = {
    ...state,
    currentLevel: {
      ...state.currentLevel,
      entities: state.currentLevel.entities.map(e => 
        e.id === player.id ? { ...e, position: { x: 1, y: 1 } } : e
      )
    }
  };

  const result = handleTransition(nonTransitionState);
  expect(result.state.messages).toHaveLength(state.messages.length + 1);
  expect(result.state.messages[result.state.messages.length - 1].text).toBe('There is no passage here.');
});
