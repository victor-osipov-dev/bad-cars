import { describe, expect, it } from 'vitest';
import type { DriveControls } from '../sim/input/DriveCommand';
import { IDLE_TOUCH_INPUT } from '../ui/TouchControls';
import { driveControlsFromKeys, InputManager } from './InputManager';

function keys(...codes: string[]): ReadonlySet<string> {
  return new Set(codes);
}

describe('driveControlsFromKeys', () => {
  it('defaults to automatic forward throttle with no steering', () => {
    expect(driveControlsFromKeys(keys())).toEqual({
      steer: 0,
      throttle: 1,
      brake: 0,
      reverse: 0,
      handbrake: false,
      interact: false,
      foundBaseToken: 0,
      buildToken: 0,
      cycleBaseToken: 0,
    });
  });

  it('maps A/D and arrow keys to opposite steering axes', () => {
    expect(driveControlsFromKeys(keys('KeyA')).steer).toBe(-1);
    expect(driveControlsFromKeys(keys('ArrowLeft')).steer).toBe(-1);
    expect(driveControlsFromKeys(keys('KeyD')).steer).toBe(1);
    expect(driveControlsFromKeys(keys('ArrowRight')).steer).toBe(1);
  });

  it('cancels steering when both directions are held', () => {
    expect(driveControlsFromKeys(keys('KeyA', 'KeyD')).steer).toBe(0);
  });

  it('maps S, ArrowDown and X to reverse without setting brake', () => {
    for (const code of ['KeyS', 'ArrowDown', 'KeyX']) {
      const controls = driveControlsFromKeys(keys(code));
      expect(controls.reverse).toBe(1);
      expect(controls.brake).toBe(0);
    }
  });

  it('maps E and F to the interact action', () => {
    expect(driveControlsFromKeys(keys('KeyE')).interact).toBe(true);
    expect(driveControlsFromKeys(keys('KeyF')).interact).toBe(true);
    expect(driveControlsFromKeys(keys('KeyE')).reverse).toBe(0);
  });

  it('maps Shift to the handbrake', () => {
    expect(driveControlsFromKeys(keys('ShiftLeft')).handbrake).toBe(true);
    expect(driveControlsFromKeys(keys('ShiftRight')).handbrake).toBe(true);
  });

  it('ignores unrelated keys', () => {
    expect(driveControlsFromKeys(keys('KeyQ', 'Escape'))).toEqual(
      driveControlsFromKeys(keys()),
    );
  });
});

describe('InputManager drive switch', () => {
  it('holds the brake until driving is enabled', () => {
    let last: DriveControls | null = null;
    const input = new InputManager((controls) => {
      last = controls;
    });

    input.sync();
    expect(last).toMatchObject({ throttle: 0, reverse: 0, brake: 1 });

    input.setDriveEnabled(true);
    expect(input.driveEnabled).toBe(true);
    expect(last).toMatchObject({ throttle: 1, reverse: 0, brake: 0 });

    input.setDriveEnabled(false);
    expect(input.driveEnabled).toBe(false);
    expect(last).toMatchObject({ throttle: 0, reverse: 0, brake: 1 });
  });

  it('lets the car reverse while held without switching driving on', () => {
    let last: DriveControls | null = null;
    const input = new InputManager((controls) => {
      last = controls;
    });

    input.sync();
    expect(input.driveEnabled).toBe(false);

    input.setTouchState({ ...IDLE_TOUCH_INPUT, reverse: true });
    expect(input.driveEnabled).toBe(false);
    expect(last).toMatchObject({ throttle: 0, reverse: 1, brake: 0 });

    input.setTouchState({ ...IDLE_TOUCH_INPUT, reverse: false });
    expect(input.driveEnabled).toBe(false);
    expect(last).toMatchObject({ throttle: 0, reverse: 0, brake: 1 });
  });
});
