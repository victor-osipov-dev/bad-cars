import { describe, expect, it } from 'vitest';
import { sweepCircle } from './sweepCircle';

describe('sweepCircle', () => {
  it('finds the entering intersection along the segment', () => {
    expect(sweepCircle(0, 0, 10, 0, 5, 0, 1)).toBeCloseTo(0.4, 12);
  });

  it('returns null when the segment misses the circle', () => {
    expect(sweepCircle(0, 0, 10, 0, 5, 2, 1)).toBeNull();
    expect(sweepCircle(0, 0, 10, 0, 20, 0, 1)).toBeNull();
  });

  it('returns zero when the start point is already inside', () => {
    expect(sweepCircle(0, 0, 10, 0, 0.5, 0, 1)).toBe(0);
    expect(sweepCircle(5, 0, 10, 0, 5, 0, 1)).toBe(0);
  });

  it('handles zero-length segments and diagonal motion', () => {
    expect(sweepCircle(0, 0, 0, 0, 5, 0, 1)).toBeNull();
    const time = sweepCircle(0, 0, 10, 10, 5, 5, 1);
    expect(time).not.toBeNull();
    expect(time ?? -1).toBeGreaterThan(0);
    expect(time ?? 2).toBeLessThan(1);
  });

  it('is deterministic and reports first contact for reversed segments', () => {
    const forward = sweepCircle(0, 0, 10, 0, 5, 0, 1);
    const forwardAgain = sweepCircle(0, 0, 10, 0, 5, 0, 1);
    expect(forward).toBe(forwardAgain);

    // The swept query returns the *entering* hit measured from the segment
    // start, so travelling against a symmetric circle yields the same
    // normalized distance (x=4 from the left, x=6 from the right), not the
    // complement 1 - t (which would be the exit point).
    const reverse = sweepCircle(10, 0, 0, 0, 5, 0, 1);
    expect(reverse).toBeCloseTo(forward ?? 0, 12);

    // The exit point is the complement: verify it explicitly instead.
    expect(1 - (reverse ?? 0)).toBeCloseTo(0.6, 12);
  });
});
