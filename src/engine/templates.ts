// Enemy templates define mechanical behavior.
// AI provides flavor (names, descriptions) based on these templates + theme.

import type { EnemyTemplate } from '../domain/model.js';

export const ENEMY_TEMPLATES: Record<string, EnemyTemplate> = {
  'enemy-common-1': {
    id: 'enemy-common-1',
    cr: 1,
    role: 'Common',
    stats: { maxHp: 7, attack: 3, defense: 1, speed: 1 },
    abilities: [{ kind: 'MeleeAttack', damage: 3, accuracy: 80 }],
    tags: ['melee', 'basic'],
  },
  'enemy-common-2': {
    id: 'enemy-common-2',
    cr: 2,
    role: 'Common',
    stats: { maxHp: 5, attack: 4, defense: 0, speed: 2 },
    abilities: [{ kind: 'MeleeAttack', damage: 4, accuracy: 70 }],
    tags: ['melee', 'fast', 'fragile'],
  },
  'enemy-elite-1': {
    id: 'enemy-elite-1',
    cr: 4,
    role: 'Elite',
    stats: { maxHp: 15, attack: 5, defense: 3, speed: 1 },
    abilities: [
      { kind: 'MeleeAttack', damage: 5, accuracy: 85 },
      { kind: 'Stun', chance: 30, duration: 1 },
    ],
    tags: ['melee', 'tough', 'stunning'],
  },
  'enemy-boss-1': {
    id: 'enemy-boss-1',
    cr: 8,
    role: 'Boss',
    stats: { maxHp: 40, attack: 8, defense: 5, speed: 1 },
    abilities: [
      { kind: 'MeleeAttack', damage: 8, accuracy: 90 },
      { kind: 'RangedAttack', damage: 5, accuracy: 75, range: 4 },
      { kind: 'Debuff', chance: 40 },
    ],
    tags: ['melee', 'ranged', 'boss', 'terrifying'],
  },
};

export function getTemplate(id: string): EnemyTemplate | undefined {
  return ENEMY_TEMPLATES[id];
}

export function getTemplatesForMonsters(templateIds: string[]): EnemyTemplate[] {
  const unique = [...new Set(templateIds)];
  return unique
    .map((id) => ENEMY_TEMPLATES[id])
    .filter((t): t is EnemyTemplate => t !== undefined);
}
