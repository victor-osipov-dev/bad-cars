import { describe, expect, it } from 'vitest';
import { FrameProfiler } from './FrameProfiler';

describe('FrameProfiler', () => {
  it('ignores invalid frame deltas without recording a sample', () => {
    const profiler = new FrameProfiler();
    profiler.sample({ frameSeconds: 0, simSeconds: 1, syncSeconds: 1, renderSeconds: 1 });
    profiler.sample({ frameSeconds: Number.NaN, simSeconds: 1, syncSeconds: 1, renderSeconds: 1 });
    expect(profiler.stats.samples).toBe(0);
    expect(profiler.stats.fps).toBe(0);
  });

  it('reports a 60 Hz frame and smooths later samples', () => {
    const profiler = new FrameProfiler();
    profiler.sample({
      frameSeconds: 1 / 60,
      simSeconds: 0.002,
      syncSeconds: 0.003,
      renderSeconds: 0.005,
      droppedSeconds: 0.1,
    });

    const first = profiler.stats;
    expect(first.samples).toBe(1);
    expect(first.frameMs).toBeCloseTo(16.6667, 3);
    expect(first.fps).toBeCloseTo(60, 3);
    expect(first.simMs).toBeCloseTo(2, 6);
    expect(first.budgetRatio).toBeCloseTo(10 / 16.6667, 3);
    expect(first.droppedSeconds).toBeCloseTo(0.1, 6);

    profiler.sample({
      frameSeconds: 1 / 30,
      simSeconds: 0.004,
      syncSeconds: 0.006,
      renderSeconds: 0.01,
      droppedSeconds: 0.05,
    });
    const second = profiler.stats;
    expect(second.samples).toBe(2);
    expect(second.frameMs).toBeGreaterThan(first.frameMs);
    expect(second.frameMs).toBeLessThan(33.4);
    expect(second.droppedSeconds).toBeCloseTo(0.15, 6);
  });

  it('resets all counters after a load or a scene rebuild', () => {
    const profiler = new FrameProfiler();
    profiler.sample({ frameSeconds: 1 / 60, simSeconds: 0.01, syncSeconds: 0.01, renderSeconds: 0.01 });
    profiler.reset();
    expect(profiler.stats).toMatchObject({ samples: 0, droppedSeconds: 0, budgetRatio: 0 });
  });
});
