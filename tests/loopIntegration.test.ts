import { describe, expect, it } from 'vitest';
import { FixedStepDriver } from '../src/core/loop/FixedStepDriver';
import { GAME_CONFIG } from '../src/data/gameplay';
import { Simulation } from '../src/sim/Simulation';

/**
 * Regression guard for the loop contract: the driver schedules ticks, the
 * simulation advances time exactly once per callback. A double time advance
 * here would make all gameplay run at half speed while still passing
 * isolated unit tests.
 */
describe('fixed-step loop integration', () => {
  it('advances the simulation exactly once per driver step', () => {
    const simulation = new Simulation();
    const driver = new FixedStepDriver(simulation.time, {
      maxSubSteps: GAME_CONFIG.maxSubSteps,
      maxFrameDeltaSeconds: GAME_CONFIG.maxFrameDeltaSeconds,
    });

    for (let frame = 0; frame < 600; frame += 1) {
      driver.advance(1 / 60, () => {
        simulation.step();
      });
    }

    expect(simulation.time.tick).toBe(600);
    expect(simulation.time.elapsedSeconds).toBeCloseTo(10, 8);

    const snapshot = simulation.snapshot();
    const spawn = GAME_CONFIG.vehicle.spawn;
    // Ten seconds of automatic throttle must move the car, but a doubled
    // clock would still produce a plausible-looking snapshot; the tick checks
    // above are the real guard.
    expect(snapshot.vehicle.speed).toBeGreaterThan(5);
    expect(snapshot.vehicle.x).toBeGreaterThan(spawn.x + 5);
    expect(snapshot.tick).toBe(600);
  });

  it('stays deterministic when driven by irregular frame deltas', () => {
    const run = (): Simulation => {
      const simulation = new Simulation();
      const driver = new FixedStepDriver(simulation.time, {
        maxSubSteps: 8,
        maxFrameDeltaSeconds: 0.25,
      });
      simulation.queueCommand({
        tick: 40,
        steer: 1,
        throttle: 1,
        brake: 0,
        reverse: 0,
        interact: false,
        handbrake: false,
      });
      const deltas = [0.016, 0.032, 0.008, 0.05, 0.016, 0.016];
      for (let i = 0; i < 200; i += 1) {
        const delta = deltas[i % deltas.length];
        if (delta === undefined) throw new Error('unreachable');
        driver.advance(delta, () => {
          simulation.step();
        });
      }
      return simulation;
    };

    const first = run();
    const second = run();
    expect(first.snapshot()).toEqual(second.snapshot());
    expect(first.time.tick).toBe(second.time.tick);
    expect(first.time.tick).toBeGreaterThan(100);
  });
});
