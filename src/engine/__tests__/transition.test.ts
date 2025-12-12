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
