/**
 * Deterministic pseudo-random generator (mulberry32).
 *
 * Simulation code must use this instead of Math.random so that a save can be
 * replayed and, later, so that multiplayer peers can stay in sync.
 */
export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new RangeError('SeededRandom seed must be a finite number');
    }
    this.#state = seed >>> 0;
  }

  /** Current internal state; serializable for saves. */
  get state(): number {
    return this.#state >>> 0;
  }

  restore(state: number): void {
    if (!Number.isFinite(state)) {
      throw new RangeError('SeededRandom state must be a finite number');
    }
    this.#state = state >>> 0;
  }

  /** Returns a number in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a number in [min, max). */
  range(min: number, max: number): number {
    if (max < min) {
      throw new RangeError(`Invalid range: [${min}, ${max})`);
    }
    return min + this.next() * (max - min);
  }

  /** Returns an integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new RangeError('SeededRandom.int requires integer bounds');
    }
    if (max < min) {
      throw new RangeError(`Invalid integer range: [${min}, ${max}]`);
    }
    const span = max - min + 1;
    return min + Math.min(span - 1, Math.floor(this.next() * span));
  }

  /** Returns true with the given probability. */
  chance(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('SeededRandom.pick requires a non-empty array');
    }
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) {
      throw new RangeError('SeededRandom.pick failed to select an item');
    }
    return item;
  }
}
