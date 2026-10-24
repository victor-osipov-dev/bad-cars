import { describe, expect, it } from 'vitest';
import {
  clampCameraCenter,
  dampCameraCenter,
  desiredFollowCenter,
  type CameraViewBounds,
} from './cameraFollow';

const VIEW: CameraViewBounds = { halfWidth: 10, halfHeight: 7 };
const ARENA: CameraViewBounds = { halfWidth: 40, halfHeight: 26 };
const DEAD_ZONE = { x: 2, y: 1 };

describe('camera follow math', () => {
  it('does not move while the target is inside the dead zone', () => {
    const center = desiredFollowCenter(
      { x: 0, y: 0 },
      { x: 1.5, y: -0.5 },
      DEAD_ZONE,
      VIEW,
      ARENA,
    );
    expect(center).toEqual({ x: 0, y: 0 });
  });

  it('follows the target just enough to keep it on the dead-zone edge', () => {
    const right = desiredFollowCenter(
      { x: 0, y: 0 },
      { x: 6, y: -4 },
      DEAD_ZONE,
      VIEW,
      ARENA,
    );
    expect(right).toEqual({ x: 4, y: -3 });
  });

  it('clamps the center so the view stays inside the arena', () => {
    const far = desiredFollowCenter(
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
      DEAD_ZONE,
      VIEW,
      ARENA,
    );
    expect(far).toEqual({ x: ARENA.halfWidth - VIEW.halfWidth, y: ARENA.halfHeight - VIEW.halfHeight });

    const clamped = clampCameraCenter({ x: -500, y: 500 }, VIEW, ARENA);
    expect(clamped).toEqual({
      x: -(ARENA.halfWidth - VIEW.halfWidth),
      y: ARENA.halfHeight - VIEW.halfHeight,
    });
  });

  it('centers the camera when the view is wider than the arena', () => {
    const wideView: CameraViewBounds = { halfWidth: 50, halfHeight: 7 };
    const center = desiredFollowCenter(
      { x: 30, y: 0 },
      { x: 35, y: 10 },
      DEAD_ZONE,
      wideView,
      ARENA,
    );
    expect(center.x).toBe(0);
  });

  it('damps smoothly and never overshoots', () => {
    const desired = { x: 10, y: -6 };
    const start = { x: 0, y: 0 };
    const quarter = dampCameraCenter(start, desired, 6, 1 / 60);
    const half = dampCameraCenter(start, desired, 6, 0.5);

    expect(quarter.x).toBeGreaterThan(0);
    expect(quarter.x).toBeLessThan(desired.x);
    expect(half.x).toBeGreaterThan(quarter.x);
    expect(half.x).toBeLessThan(desired.x);
    expect(dampCameraCenter(start, desired, 0, 0.1)).toEqual(start);
    expect(dampCameraCenter(start, desired, 6, 0)).toEqual(start);
  });
});
