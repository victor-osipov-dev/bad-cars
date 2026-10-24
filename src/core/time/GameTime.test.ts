import { describe, expect, it } from 'vitest';
import { GameTime } from './GameTime';

function createTime(overrides: Partial<ConstructorParameters<typeof GameTime>[0]> = {}): GameTime {
  return new GameTime({
    fixedStepSeconds: 0.5,
    dayLengthSeconds: 4,
    ...overrides,
  });
}

describe('GameTime', () => {
  it('starts at tick 0 with zero elapsed time', () => {
    const time = createTime();
    expect(time.tick).toBe(0);
    expect(time.elapsedSeconds).toBe(0);
    expect(time.dayIndex).toBe(0);
    expect(time.dayPhase).toBe(0);
    expect(time.hourOfDay).toBe(0);
  });

  it('derives time from the integer tick counter (no drift)', () => {
    const time = new GameTime({ fixedStepSeconds: 1 / 60, dayLengthSeconds: 600 });
    for (let i = 0; i < 3600; i += 1) {
      time.advanceStep();
    }
    expect(time.tick).toBe(3600);
    expect(time.elapsedSeconds).toBeCloseTo(60, 10);
  });

  it('advances by multiple steps', () => {
    const time = createTime();
    time.advanceStep(3);
    expect(time.tick).toBe(3);
    expect(time.elapsedSeconds).toBe(1.5);
  });

  it('rolls over days at the exact boundary', () => {
    const time = createTime({ fixedStepSeconds: 0.5, dayLengthSeconds: 4 });
    time.advanceStep(8);
    expect(time.elapsedSeconds).toBe(4);
    expect(time.totalDays).toBe(1);
    expect(time.dayIndex).toBe(1);
    expect(time.dayPhase).toBe(0);
    expect(time.hourOfDay).toBe(0);
  });

  it('computes day phase and hour of day mid-day', () => {
    const time = createTime({ fixedStepSeconds: 0.5, dayLengthSeconds: 4 });
    time.advanceStep(6);
    expect(time.elapsedSeconds).toBe(3);
    expect(time.dayIndex).toBe(0);
    expect(time.dayPhase).toBeCloseTo(0.75, 12);
    expect(time.hourOfDay).toBeCloseTo(18, 12);
  });

  it('reports partial days across multiple days', () => {
    const time = createTime({ fixedStepSeconds: 0.5, dayLengthSeconds: 4 });
    time.advanceStep(21);
    expect(time.elapsedSeconds).toBe(10.5);
    expect(time.dayIndex).toBe(2);
    expect(time.dayPhase).toBeCloseTo(0.625, 12);
    expect(time.hourOfDay).toBeCloseTo(15, 12);
  });

  it('supports a starting tick for loaded saves', () => {
    const time = createTime({ startTick: 100 });
    expect(time.tick).toBe(100);
    expect(time.elapsedSeconds).toBe(50);
  });

  it('rejects invalid configuration', () => {
    expect(() => new GameTime({ fixedStepSeconds: 0, dayLengthSeconds: 1 })).toThrow(RangeError);
    expect(() => new GameTime({ fixedStepSeconds: -1, dayLengthSeconds: 1 })).toThrow(RangeError);
    expect(() => new GameTime({ fixedStepSeconds: Number.NaN, dayLengthSeconds: 1 })).toThrow(
      RangeError,
    );
    expect(() => new GameTime({ fixedStepSeconds: 1, dayLengthSeconds: 0 })).toThrow(RangeError);
    expect(() => new GameTime({ fixedStepSeconds: 1, dayLengthSeconds: 1, startTick: -1 })).toThrow(
      RangeError,
    );
    expect(() => new GameTime({ fixedStepSeconds: 1, dayLengthSeconds: 1, startTick: 1.5 })).toThrow(
      RangeError,
    );
  });

  it('rejects invalid step counts', () => {
    const time = createTime();
    expect(() => time.advanceStep(-1)).toThrow(RangeError);
    expect(() => time.advanceStep(1.5)).toThrow(RangeError);
  });
});
