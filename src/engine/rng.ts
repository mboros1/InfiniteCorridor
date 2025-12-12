// Deterministic pseudo-random number generator using a simple mulberry32 algorithm.
// Same seed always produces the same sequence of numbers.

export function hashSeed(seedString: string): number {
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    const char = seedString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export interface RNG {
  next(): number;        // Returns float in [0, 1)
  nextInt(max: number): number;  // Returns int in [0, max)
  nextIntRange(min: number, max: number): number; // Returns int in [min, max)
  nextBool(chance?: number): boolean; // Returns true with given probability (default 0.5)
  pick<T>(array: readonly T[]): T; // Pick random element from array
  shuffle<T>(array: T[]): T[]; // Shuffle array in place
}

export function createRNG(seed: number): RNG {
  let state = seed;

  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(max: number): number {
    return Math.floor(next() * max);
  }

  function nextIntRange(min: number, max: number): number {
    return min + Math.floor(next() * (max - min));
  }

  function nextBool(chance = 0.5): boolean {
    return next() < chance;
  }

  function pick<T>(array: readonly T[]): T {
    return array[nextInt(array.length)];
  }

  function shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = nextInt(i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  return { next, nextInt, nextIntRange, nextBool, pick, shuffle };
}
