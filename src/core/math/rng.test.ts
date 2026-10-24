import { describe, expect, it } from 'vitest';
import { SeededRandom } from './rng';

describe('SeededRandom', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new SeededRandom(12345);
    const b = new SeededRandom(12345);
    const sequenceA = Array.from({ length: 20 }, () => a.next());
    const sequenceB = Array.from({ length: 20 }, () => b.next());

    expect(sequenceA).toEqual(sequenceB);
    expect(new Set(sequenceA).size).toBeGreaterThan(1);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('keeps next() in [0, 1)', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps range() inside the requested interval', () => {
    const rng = new SeededRandom(99);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.range(-3, 8);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(8);
    }
  });

  it('returns inclusive integer bounds', () => {
    const rng = new SeededRandom(2024);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.int(1, 4);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(4);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('handles single-value integer ranges', () => {
    const rng = new SeededRandom(5);
    expect(rng.int(3, 3)).toBe(3);
  });

  it('validates ranges', () => {
    const rng = new SeededRandom(1);
    expect(() => rng.range(5, 1)).toThrow(RangeError);
    expect(() => rng.int(1.5, 3)).toThrow(RangeError);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('handles chance probabilities', () => {
    const rng = new SeededRandom(11);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(-1)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(rng.chance(2)).toBe(true);

    let hits = 0;
    for (let i = 0; i < 10_000; i += 1) {
      if (rng.chance(0.5)) hits += 1;
    }
    expect(hits).toBeGreaterThan(4500);
    expect(hits).toBeLessThan(5500);
  });

  it('picks items deterministically', () => {
    const items = ['a', 'b', 'c', 'd'] as const;
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const picksA = Array.from({ length: 25 }, () => a.pick(items));
    const picksB = Array.from({ length: 25 }, () => b.pick(items));
    expect(picksA).toEqual(picksB);
    expect(picksA.every((item) => items.includes(item))).toBe(true);
  });

  it('restores its exact state', () => {
    const rng = new SeededRandom(777);
    rng.next();
    rng.next();
    const savedState = rng.state;
    const expected = Array.from({ length: 10 }, () => rng.next());

    const restored = new SeededRandom(0);
    restored.restore(savedState);
    const actual = Array.from({ length: 10 }, () => restored.next());

    expect(actual).toEqual(expected);
  });

  it('rejects non-finite seeds and state', () => {
    expect(() => new SeededRandom(Number.NaN)).toThrow(RangeError);
    const rng = new SeededRandom(1);
    expect(() => rng.restore(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
