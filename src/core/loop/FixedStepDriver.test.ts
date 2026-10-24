import { describe, expect, it } from 'vitest';
import { GameTime } from '../time/GameTime';
import { FixedStepDriver } from './FixedStepDriver';

function createDriver(
  stepSeconds = 0.01,
  options: ConstructorParameters<typeof FixedStepDriver>[1] = {},
): { time: GameTime; driver: FixedStepDriver; step: () => void } {
  const time = new GameTime({ fixedStepSeconds: stepSeconds, dayLengthSeconds: 100 });
  const driver = new FixedStepDriver(time, options);
  return { time, driver, step: () => time.advanceStep() };
}

describe('FixedStepDriver', () => {
  it('does not step for zero, negative or non-finite deltas', () => {
    const { time, driver, step } = createDriver();
    expect(driver.advance(0, step).steps).toBe(0);
    expect(driver.advance(-1, step).steps).toBe(0);
    expect(driver.advance(Number.NaN, step).steps).toBe(0);
    expect(driver.advance(Number.POSITIVE_INFINITY, step).steps).toBe(0);
    expect(time.tick).toBe(0);
  });

  it('executes exactly one step for one fixed delta', () => {
    const { time, driver, step } = createDriver();
    const result = driver.advance(0.01, step);
    expect(result.steps).toBe(1);
    expect(time.tick).toBe(1);
    expect(result.accumulatorSeconds).toBeCloseTo(0, 12);
  });

  it('executes multiple steps for a larger delta', () => {
    const { time, driver, step } = createDriver();
    const result = driver.advance(0.035, step);
    expect(result.steps).toBe(3);
    expect(time.tick).toBe(3);
    expect(result.accumulatorSeconds).toBeCloseTo(0.005, 12);
    expect(result.alpha).toBeCloseTo(0.5, 12);
  });

  it('accumulates fractional deltas without losing time', () => {
    const { time, driver, step } = createDriver();
    expect(driver.advance(0.004, step).steps).toBe(0);
    expect(driver.advance(0.004, step).steps).toBe(0);
    expect(driver.advance(0.004, step).steps).toBe(1);
    expect(time.tick).toBe(1);
    expect(driver.accumulatorSeconds).toBeCloseTo(0.002, 12);
  });

  it('invokes the step callback once per tick, in order', () => {
    const { time, driver } = createDriver();
    const ticks: number[] = [];
    driver.advance(0.03, () => {
      time.advanceStep();
      ticks.push(time.tick);
    });
    expect(ticks).toEqual([1, 2, 3]);
    expect(time.tick).toBe(3);
  });

  it('does not advance the clock on its own', () => {
    const { time, driver } = createDriver();
    const result = driver.advance(0.1);
    expect(result.steps).toBe(8);
    expect(time.tick).toBe(0);
  });

  it('caps sub-steps per frame and counts dropped time', () => {
    const { time, driver, step } = createDriver(0.01, {
      maxSubSteps: 5,
      maxFrameDeltaSeconds: 10,
    });
    const result = driver.advance(0.1, step);

    expect(result.steps).toBe(5);
    expect(time.tick).toBe(5);
    expect(result.droppedSeconds).toBeCloseTo(0.05, 12);
    expect(driver.droppedSecondsTotal).toBeCloseTo(0.05, 12);
    expect(driver.accumulatorSeconds).toBeCloseTo(0, 12);
  });

  it('clamps frame time before accumulating', () => {
    const { time, driver, step } = createDriver(0.01, {
      maxSubSteps: 100,
      maxFrameDeltaSeconds: 0.05,
    });
    const result = driver.advance(1.0, step);

    expect(result.steps).toBe(5);
    expect(time.tick).toBe(5);
    expect(result.droppedSeconds).toBe(0);
    expect(driver.accumulatorSeconds).toBeCloseTo(0, 12);
  });

  it('keeps a stable tick count over many 60 Hz frames', () => {
    const time = new GameTime({ fixedStepSeconds: 1 / 60, dayLengthSeconds: 600 });
    const driver = new FixedStepDriver(time, {
      maxSubSteps: 8,
      maxFrameDeltaSeconds: 0.25,
    });

    for (let frame = 0; frame < 600; frame += 1) {
      driver.advance(1 / 60, () => time.advanceStep());
    }

    expect(time.tick).toBe(600);
    expect(driver.droppedSecondsTotal).toBe(0);
    expect(driver.accumulatorSeconds).toBeLessThan(1e-9);
  });

  it('never reports alpha outside [0, 1)', () => {
    const { driver } = createDriver();
    const deltas = [0, 0.001, 0.0099, 0.01, 0.014, 0.033];
    for (const delta of deltas) {
      const result = driver.advance(delta);
      expect(result.alpha).toBeGreaterThanOrEqual(0);
      expect(result.alpha).toBeLessThan(1);
    }
  });

  it('reset clears the accumulator and dropped counter', () => {
    const { driver } = createDriver(0.01, { maxSubSteps: 1, maxFrameDeltaSeconds: 1 });
    driver.advance(0.1);
    expect(driver.droppedSecondsTotal).toBeGreaterThan(0);
    driver.reset();
    expect(driver.accumulatorSeconds).toBe(0);
    expect(driver.droppedSecondsTotal).toBe(0);
  });

  it('validates options', () => {
    const time = new GameTime({ fixedStepSeconds: 0.01, dayLengthSeconds: 10 });
    expect(() => new FixedStepDriver(time, { maxSubSteps: 0 })).toThrow(RangeError);
    expect(() => new FixedStepDriver(time, { maxFrameDeltaSeconds: 0 })).toThrow(RangeError);
    expect(() => new FixedStepDriver(time, { maxFrameDeltaSeconds: Number.NaN })).toThrow(RangeError);
  });
});
