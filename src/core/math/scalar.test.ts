import { describe, expect, it } from 'vitest';
import {
  approxEqual,
  clamp,
  damp,
  inverseLerp,
  lerp,
  moveTowards,
  smoothstep,
} from './scalar';

describe('scalar math', () => {
  describe('clamp', () => {
    it('returns values inside and on the bounds unchanged', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });

    it('clamps values outside the range', () => {
      expect(clamp(-2, 0, 10)).toBe(0);
      expect(clamp(42, 0, 10)).toBe(10);
    });

    it('falls back to min for NaN', () => {
      expect(clamp(Number.NaN, 3, 7)).toBe(3);
    });

    it('handles infinities', () => {
      expect(clamp(Number.POSITIVE_INFINITY, 0, 1)).toBe(1);
      expect(clamp(Number.NEGATIVE_INFINITY, 0, 1)).toBe(0);
    });
  });

  describe('lerp / inverseLerp', () => {
    it('interpolates and extrapolates', () => {
      expect(lerp(10, 20, 0)).toBe(10);
      expect(lerp(10, 20, 1)).toBe(20);
      expect(lerp(10, 20, 0.5)).toBe(15);
      expect(lerp(10, 20, 2)).toBe(30);
    });

    it('inverts lerp', () => {
      expect(inverseLerp(10, 20, 15)).toBeCloseTo(0.5, 12);
      expect(inverseLerp(10, 20, 10)).toBe(0);
      expect(inverseLerp(10, 20, 20)).toBe(1);
    });

    it('returns 0 for a degenerate range', () => {
      expect(inverseLerp(7, 7, 7)).toBe(0);
    });
  });

  describe('moveTowards', () => {
    it('moves by at most maxDelta', () => {
      expect(moveTowards(0, 10, 3)).toBe(3);
      expect(moveTowards(10, 0, 3)).toBe(7);
    });

    it('snaps when the remaining distance is within maxDelta', () => {
      expect(moveTowards(9, 10, 3)).toBe(10);
      expect(moveTowards(10, 9, 3)).toBe(9);
      expect(moveTowards(4, 4, 3)).toBe(4);
    });
  });

  describe('damp', () => {
    it('is frame-rate independent when split into two steps', () => {
      const lambda = 4;
      const single = damp(0, 100, lambda, 0.2);
      const split = damp(damp(0, 100, lambda, 0.1), 100, lambda, 0.1);
      expect(split).toBeCloseTo(single, 10);
    });

    it('returns current for non-positive lambda or delta', () => {
      expect(damp(4, 10, 0, 1)).toBe(4);
      expect(damp(4, 10, 2, 0)).toBe(4);
      expect(damp(4, 10, 2, -1)).toBe(4);
    });
  });

  describe('smoothstep', () => {
    it('clamps outside the edges and is smooth in between', () => {
      expect(smoothstep(0, 1, -1)).toBe(0);
      expect(smoothstep(0, 1, 2)).toBe(1);
      expect(smoothstep(0, 1, 0.5)).toBe(0.5);
      expect(smoothstep(0, 1, 0.25)).toBeCloseTo(0.15625, 12);
    });

    it('handles degenerate edges', () => {
      expect(smoothstep(2, 2, 1)).toBe(0);
      expect(smoothstep(2, 2, 3)).toBe(1);
    });
  });

  describe('approxEqual', () => {
    it('compares within epsilon and detects NaN', () => {
      expect(approxEqual(1, 1 + 1e-10)).toBe(true);
      expect(approxEqual(1, 1.1)).toBe(false);
      expect(approxEqual(Number.NaN, Number.NaN)).toBe(false);
    });
  });
});
