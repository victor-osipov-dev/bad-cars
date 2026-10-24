import { describe, expect, it } from 'vitest';
import { Vec2 } from './Vec2';

describe('Vec2', () => {
  it('supports basic arithmetic immutably', () => {
    const a = new Vec2(3, 4);
    const b = new Vec2(-1, 2);

    expect(a.add(b)).toEqual(new Vec2(2, 6));
    expect(a.sub(b)).toEqual(new Vec2(4, 2));
    expect(a.scale(2)).toEqual(new Vec2(6, 8));
    expect(a.negate()).toEqual(new Vec2(-3, -4));
    expect(a).toEqual(new Vec2(3, 4));
    expect(Vec2.ZERO).toEqual(new Vec2(0, 0));
  });

  it('computes dot, cross and lengths', () => {
    const a = new Vec2(3, 4);
    const b = new Vec2(-4, 3);

    expect(a.dot(b)).toBe(0);
    expect(a.cross(b)).toBe(25);
    expect(a.lengthSquared()).toBe(25);
    expect(a.length()).toBe(5);
    expect(a.distanceTo(new Vec2(0, 0))).toBe(5);
    expect(a.distanceSquaredTo(new Vec2(0, 0))).toBe(25);
  });

  it('normalizes and handles zero vectors', () => {
    expect(new Vec2(0, 5).normalized()).toEqual(new Vec2(0, 1));
    expect(new Vec2(3, 4).normalized().length()).toBeCloseTo(1, 12);
    expect(Vec2.ZERO.normalized()).toBe(Vec2.ZERO);
  });

  it('rotates counter-clockwise', () => {
    const right = new Vec2(1, 0);
    const up = right.rotate(Math.PI / 2);
    expect(up.x).toBeCloseTo(0, 12);
    expect(up.y).toBeCloseTo(1, 12);
    expect(new Vec2(0, 1).perpendicular()).toEqual(new Vec2(-1, 0));
  });

  it('creates vectors from angles', () => {
    const v = Vec2.fromAngle(Math.PI / 2, 3);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(3, 12);
    expect(Vec2.fromAngle(0).angle()).toBeCloseTo(0, 12);
  });

  it('lerps and compares with epsilon', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(10, 20);
    expect(a.lerp(b, 0.5)).toEqual(new Vec2(5, 10));
    expect(a.equals(new Vec2(1e-10, -1e-10))).toBe(true);
    expect(a.equals(new Vec2(1e-6, 0))).toBe(false);
    expect(a.equals(new Vec2(1e-6, 0), 1e-5)).toBe(true);
  });

  it('serializes to a plain object', () => {
    expect(new Vec2(1.5, -2.5).toJSON()).toEqual({ x: 1.5, y: -2.5 });
  });
});
