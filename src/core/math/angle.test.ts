import { describe, expect, it } from 'vitest';
import {
  HALF_PI,
  TAU,
  angleDifference,
  lerpAngle,
  rotateTowards,
  toDegrees,
  toRadians,
  wrapAngle,
} from './angle';

describe('angle math', () => {
  it('wraps angles into [-PI, PI)', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(HALF_PI)).toBe(HALF_PI);
    expect(wrapAngle(TAU)).toBeCloseTo(0, 12);
    expect(wrapAngle(-TAU)).toBeCloseTo(0, 12);
    expect(wrapAngle(TAU + 0.25)).toBeCloseTo(0.25, 12);
    expect(wrapAngle(-TAU - 0.25)).toBeCloseTo(-0.25, 12);
    expect(wrapAngle(Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapAngle(Number.NaN)).toBe(0);
  });

  it('keeps wrapped results inside the documented range', () => {
    for (let i = -20; i <= 20; i += 1) {
      const wrapped = wrapAngle(i * 0.7);
      expect(wrapped).toBeGreaterThanOrEqual(-Math.PI);
      expect(wrapped).toBeLessThan(Math.PI);
    }
  });

  it('computes the shortest signed difference across the wrap point', () => {
    expect(angleDifference(0, HALF_PI)).toBeCloseTo(HALF_PI, 12);
    expect(angleDifference(HALF_PI, 0)).toBeCloseTo(-HALF_PI, 12);
    // From 170° to -170° the shortest path is +20°, not -340°.
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    expect(angleDifference(from, to)).toBeCloseTo((20 * Math.PI) / 180, 12);
  });

  it('rotates towards a target along the shortest arc', () => {
    expect(rotateTowards(0, 1, 0.25)).toBeCloseTo(0.25, 12);
    expect(rotateTowards(0, -1, 0.25)).toBeCloseTo(-0.25, 12);
    expect(rotateTowards(0, 0.2, 1)).toBeCloseTo(0.2, 12);
    expect(rotateTowards(1, 1, 0)).toBeCloseTo(1, 12);

    const from = (179 * Math.PI) / 180;
    const to = (-179 * Math.PI) / 180;
    // The shortest path is +2° across the wrap point, so within a 1° budget
    // the result is 180°, normalized to -PI.
    const rotated = rotateTowards(from, to, Math.PI / 180);
    expect(rotated).toBeCloseTo(-Math.PI, 12);

    // A budget large enough to cover the shortest arc snaps to the target.
    expect(rotateTowards(from, to, (5 * Math.PI) / 180)).toBeCloseTo(to, 12);
  });

  it('interpolates angles along the shortest arc', () => {
    expect(lerpAngle(0, HALF_PI, 0.5)).toBeCloseTo(Math.PI / 4, 12);
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    const mid = lerpAngle(from, to, 0.5);
    expect(Math.abs(mid)).toBeCloseTo(Math.PI, 12);
  });

  it('converts degrees and radians', () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 12);
    expect(toDegrees(Math.PI)).toBeCloseTo(180, 12);
    expect(toRadians(0)).toBe(0);
  });
});
