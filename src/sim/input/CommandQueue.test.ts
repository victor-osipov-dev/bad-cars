import { describe, expect, it } from 'vitest';
import { CommandQueue } from './CommandQueue';
import { AUTO_DRIVE_CONTROLS, createDriveControls } from './DriveCommand';

describe('createDriveControls', () => {
  it('defaults to automatic throttle with no steering', () => {
    expect(createDriveControls()).toEqual(AUTO_DRIVE_CONTROLS);
  });

  it('clamps analog axes and sanitizes non-finite values', () => {
    expect(createDriveControls({ steer: 4, throttle: 2, brake: -3 })).toEqual({
      steer: 1,
      throttle: 1,
      brake: 0,
      reverse: 0,
      interact: false,
      handbrake: false,
    });
    expect(createDriveControls({ steer: Number.NaN, throttle: Number.NaN })).toEqual({
      steer: 0,
      throttle: 0,
      brake: 0,
      reverse: 0,
      interact: false,
      handbrake: false,
    });
  });
});

describe('CommandQueue', () => {
  it('starts with the automatic-throttle default', () => {
    const queue = new CommandQueue();
    expect(queue.active.tick).toBe(0);
    expect(queue.advanceTo(0)).toEqual(AUTO_DRIVE_CONTROLS);
  });

  it('applies commands on their tick, not earlier', () => {
    const queue = new CommandQueue();
    queue.enqueue({ tick: 5, steer: 1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false });

    expect(queue.advanceTo(4).steer).toBe(0);
    expect(queue.advanceTo(5).steer).toBe(1);
    expect(queue.pendingCount).toBe(0);
  });

  it('keeps the latest command active until a newer one arrives', () => {
    const queue = new CommandQueue();
    queue.enqueue({ tick: 1, steer: -1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false });
    queue.enqueue({ tick: 10, steer: 0, throttle: 1, brake: 1, reverse: 0, interact: false, handbrake: false });

    expect(queue.advanceTo(2).steer).toBe(-1);
    expect(queue.advanceTo(9).brake).toBe(0);
    expect(queue.advanceTo(10).brake).toBe(1);
    expect(queue.active.tick).toBe(10);
  });

  it('orders commands by tick regardless of enqueue order', () => {
    const queue = new CommandQueue();
    queue.enqueue({ tick: 10, steer: 1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false });
    queue.enqueue({ tick: 7, steer: -1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: true });

    expect(queue.advanceTo(7)).toMatchObject({ steer: -1, handbrake: true });
    expect(queue.advanceTo(10).steer).toBe(1);
  });

  it('replaces a queued command for the same tick', () => {
    const queue = new CommandQueue();
    queue.enqueue({ tick: 3, steer: 1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false });
    queue.enqueue({ tick: 3, steer: -1, throttle: 0, brake: 0, reverse: 0, interact: false, handbrake: false });

    expect(queue.pendingCount).toBe(1);
    expect(queue.advanceTo(3)).toMatchObject({ steer: -1, throttle: 0 });
  });

  it('applies a late command immediately instead of rewinding', () => {
    const queue = new CommandQueue();
    queue.enqueue({ tick: 10, steer: 1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false });
    expect(queue.advanceTo(10).steer).toBe(1);

    queue.enqueue({ tick: 4, steer: -1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false });
    expect(queue.advanceTo(10).steer).toBe(-1);
    expect(queue.active.tick).toBe(4);
  });

  it('sanitizes commands before storing them', () => {
    const queue = new CommandQueue();
    queue.enqueue({ tick: 1, steer: 9, throttle: 5, brake: -1, reverse: 0, interact: false, handbrake: true });
    expect(queue.advanceTo(1)).toEqual({
      steer: 1,
      throttle: 1,
      brake: 0,
      reverse: 0,
      interact: false,
      handbrake: true,
    });
  });

  it('clamps reverse input to 0..1', () => {
    const queue = new CommandQueue();
    queue.enqueue({ tick: 1, steer: 0, throttle: 1, brake: 0, reverse: 7, interact: false, handbrake: false });
    expect(queue.advanceTo(1)).toMatchObject({ reverse: 1 });

    const negative = new CommandQueue();
    negative.enqueue({ tick: 1, steer: 0, throttle: 1, brake: 0, reverse: -3, interact: false, handbrake: false });
    expect(negative.advanceTo(1)).toMatchObject({ reverse: 0 });
  });

  it('rejects invalid ticks', () => {
    const queue = new CommandQueue();
    expect(() =>
      queue.enqueue({ tick: -1, steer: 1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false }),
    ).toThrow(RangeError);
    expect(() =>
      queue.enqueue({ tick: 1.5, steer: 1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false }),
    ).toThrow(RangeError);
    expect(() => queue.advanceTo(Number.NaN)).toThrow(RangeError);
  });

  it('caps the pending buffer to protect memory', () => {
    const queue = new CommandQueue();
    for (let tick = 1; tick <= 300; tick += 1) {
      queue.enqueue({ tick, steer: 0, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false });
    }
    expect(queue.pendingCount).toBeLessThanOrEqual(240);
    expect(queue.advanceTo(300).throttle).toBe(1);
  });
});
