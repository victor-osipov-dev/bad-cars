import { describe, expect, it } from 'vitest';
import { AimCommandQueue } from './AimCommandQueue';
import { aimControlsEqual, createAimControls, DEFAULT_AIM_CONTROLS } from './AimCommand';

describe('createAimControls', () => {
  it('defaults to following the vehicle heading with no fire', () => {
    expect(createAimControls()).toEqual(DEFAULT_AIM_CONTROLS);
  });

  it('sanitizes aim points, slot and reload token', () => {
    expect(
      createAimControls({
        aimPoint: { x: Number.NaN, y: 4 },
        activeSlot: -2,
        reloadToken: 1.5,
      }),
    ).toEqual({
      aimPoint: null,
      fire: false,
      activeSlot: 0,
      reloadToken: 0,
    });

    expect(
      createAimControls({
        aimPoint: { x: 3, y: -2 },
        fire: true,
        activeSlot: 1,
        reloadToken: 4,
      }),
    ).toEqual({
      aimPoint: { x: 3, y: -2 },
      fire: true,
      activeSlot: 1,
      reloadToken: 4,
    });
  });

  it('compares aim controls with a world-space epsilon', () => {
    const base = createAimControls({ aimPoint: { x: 5, y: 5 } });
    expect(aimControlsEqual(base, createAimControls({ aimPoint: { x: 5.001, y: 5 } }))).toBe(true);
    expect(aimControlsEqual(base, createAimControls({ aimPoint: { x: 5.1, y: 5 } }))).toBe(false);
    expect(aimControlsEqual(base, createAimControls({ aimPoint: null }))).toBe(false);
  });
});

describe('AimCommandQueue', () => {
  it('applies commands on their tick and keeps them active', () => {
    const queue = new AimCommandQueue();
    queue.enqueue({
      tick: 5,
      aimPoint: { x: 10, y: 0 },
      fire: true,
      activeSlot: 1,
      reloadToken: 0,
    });

    expect(queue.advanceTo(4)).toEqual(DEFAULT_AIM_CONTROLS);
    const active = queue.advanceTo(5);
    expect(active.aimPoint).toEqual({ x: 10, y: 0 });
    expect(active.fire).toBe(true);
    expect(active.activeSlot).toBe(1);
    expect(queue.advanceTo(20).fire).toBe(true);
  });

  it('orders commands by tick and uses the latest for the same tick', () => {
    const queue = new AimCommandQueue();
    queue.enqueue({
      tick: 10,
      aimPoint: { x: 1, y: 1 },
      fire: true,
      activeSlot: 0,
      reloadToken: 0,
    });
    queue.enqueue({
      tick: 7,
      aimPoint: { x: 2, y: 2 },
      fire: false,
      activeSlot: 0,
      reloadToken: 1,
    });
    queue.enqueue({
      tick: 7,
      aimPoint: { x: 3, y: 3 },
      fire: false,
      activeSlot: 0,
      reloadToken: 2,
    });

    expect(queue.pendingCount).toBe(2);
    expect(queue.advanceTo(7)).toMatchObject({
      aimPoint: { x: 3, y: 3 },
      reloadToken: 2,
    });
    expect(queue.advanceTo(10).fire).toBe(true);
  });

  it('rejects invalid ticks', () => {
    const queue = new AimCommandQueue();
    expect(() =>
      queue.enqueue({
        tick: -1,
        aimPoint: null,
        fire: false,
        activeSlot: 0,
        reloadToken: 0,
      }),
    ).toThrow(RangeError);
    expect(() => queue.advanceTo(1.5)).toThrow(RangeError);
  });

  it('caps the pending buffer', () => {
    const queue = new AimCommandQueue();
    for (let tick = 1; tick <= 300; tick += 1) {
      queue.enqueue({
        tick,
        aimPoint: { x: tick, y: 0 },
        fire: false,
        activeSlot: 0,
        reloadToken: 0,
      });
    }
    expect(queue.pendingCount).toBeLessThanOrEqual(240);
    expect(queue.advanceTo(300).aimPoint).toEqual({ x: 300, y: 0 });
  });
});
