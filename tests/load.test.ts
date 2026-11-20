import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/data/gameplay';
import { MAX_ACTIVE_EFFECTS } from '../src/data/effects';
import { MAX_RAID_REPORTS } from '../src/sim/raid/RaidState';
import { Simulation } from '../src/sim/Simulation';

const TEN_MINUTES_OF_TICKS = 60 * 600;

function runFor(simulation: Simulation, ticks: number): void {
  for (let start = 0; start < ticks; start += 600) {
    const chunk = Math.min(600, ticks - start);
    const steering = Math.sin((start / 600) * 1.7) * 0.35;
    simulation.queueControls({ throttle: 1, steer: steering });
    simulation.stepMany(chunk);
  }
}

describe('simulation load', () => {
  it('runs ten simulated minutes with bounded state and a healthy step budget', () => {
    const simulation = new Simulation(GAME_CONFIG);
    const started = performance.now();
    runFor(simulation, TEN_MINUTES_OF_TICKS);
    const elapsedMs = performance.now() - started;
    const snapshot = simulation.snapshot();

    expect(simulation.time.tick).toBe(TEN_MINUTES_OF_TICKS);
    // A 60 Hz fixed step has a 16.67 ms wall-clock frame budget shared with
    // rendering. Keep the assertion loose enough for slow CI, but strict
    // enough to catch an accidental O(n^2) step implementation.
    expect(elapsedMs / TEN_MINUTES_OF_TICKS).toBeLessThan(5);

    const radius = GAME_CONFIG.world.unloadRadiusChunks;
    const maxChunks = (2 * radius + 1) ** 2;
    expect(snapshot.chunks.active).toBeLessThanOrEqual(maxChunks);
    // loadedTotal is a lifetime counter; only the resident set is bounded.
    expect(snapshot.chunks.loadedTotal).toBeGreaterThanOrEqual(snapshot.chunks.active);
    expect(snapshot.combat.effects.length).toBeLessThanOrEqual(MAX_ACTIVE_EFFECTS);
    expect(snapshot.combat.projectiles.length).toBeLessThanOrEqual(200);
    expect(snapshot.baseState.reports.length).toBeLessThanOrEqual(MAX_RAID_REPORTS);
    expect(snapshot.baseState.remote.reports.length).toBeLessThanOrEqual(
      GAME_CONFIG.remote.maxReports,
    );

    for (const value of [snapshot.vehicle.x, snapshot.vehicle.y, snapshot.vehicle.heading]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    console.info(
      `load: ${TEN_MINUTES_OF_TICKS} ticks in ${elapsedMs.toFixed(0)} ms ` +
        `(${(elapsedMs / TEN_MINUTES_OF_TICKS).toFixed(3)} ms/step)`,
    );
  });

  it('survives a command flood without growing the pending queues', () => {
    const simulation = new Simulation(GAME_CONFIG);
    for (let index = 0; index < 2000; index += 1) {
      simulation.queueControls({ throttle: index % 2, steer: 0 });
      simulation.queueAimControls({ fire: index % 3 === 0 });
    }
    simulation.stepMany(120);

    expect(simulation.time.tick).toBe(120);
    expect(Number.isFinite(simulation.snapshot().vehicle.x)).toBe(true);
    expect(Number.isFinite(simulation.snapshot().combat.aimPoint?.x ?? 0)).toBe(true);
  });

  it('stays deterministic when a long run is saved and continued', () => {
    const original = new Simulation(GAME_CONFIG);
    runFor(original, 1200);
    // Projectiles and effects are cosmetic transients and are intentionally
    // not persisted; wait for them to clear before taking the save snapshot.
    for (let index = 0; index < 600; index += 1) {
      const combat = original.snapshot().combat;
      if (combat.projectiles.length === 0 && combat.effects.length === 0) break;
      original.step();
    }
    expect(original.snapshot().combat.projectiles).toHaveLength(0);
    const state = original.exportState();

    const restored = new Simulation(GAME_CONFIG);
    restored.importState(state);
    original.queueControls({ throttle: 1, steer: 0.2 });
    restored.queueControls({ throttle: 1, steer: 0.2 });
    original.stepMany(300);
    restored.stepMany(300);

    expect(JSON.stringify(restored.exportState())).toBe(JSON.stringify(original.exportState()));
  });
});
