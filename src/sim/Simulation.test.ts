import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../data/gameplay';
import { Simulation } from './Simulation';

describe('Simulation', () => {
  it('starts at tick zero with the vehicle at its spawn point', () => {
    const simulation = new Simulation();
    const snapshot = simulation.snapshot();
    const spawn = GAME_CONFIG.vehicle.spawn;

    expect(snapshot.tick).toBe(0);
    expect(snapshot.elapsedSeconds).toBe(0);
    expect(snapshot.vehicle.x).toBe(spawn.x);
    expect(snapshot.vehicle.y).toBe(spawn.y);
    expect(snapshot.vehicle.speed).toBe(0);
    expect(snapshot.vehicle.steering).toBe(0);
    // The spawn range is handcrafted and always resident; procedural chunks add
    // more props on top of it.
    expect(snapshot.props.length).toBeGreaterThanOrEqual(GAME_CONFIG.props.length);
    expect(snapshot.minimap.chunks.length).toBeGreaterThan(0);
    expect(snapshot.chunks.active).toBe(snapshot.minimap.chunks.length);
  });

  it('advances one fixed tick per step', () => {
    const simulation = new Simulation();
    simulation.step();
    expect(simulation.time.tick).toBe(1);
    expect(simulation.time.elapsedSeconds).toBeCloseTo(1 / 60, 12);
    expect(simulation.snapshot().tick).toBe(1);
  });

  it('drives forward automatically with the default controls', () => {
    const simulation = new Simulation();
    const spawn = GAME_CONFIG.vehicle.spawn;
    simulation.stepMany(60);
    const snapshot = simulation.snapshot();

    expect(snapshot.vehicle.speed).toBeGreaterThan(2);
    expect(snapshot.vehicle.x).toBeGreaterThan(spawn.x + 1);
    expect(snapshot.vehicle.y).toBeCloseTo(spawn.y, 6);
  });

  it('applies a steering command on exactly the requested tick', () => {
    const simulation = new Simulation();
    simulation.queueCommand({
      tick: 10,
      steer: 1,
      throttle: 1,
      brake: 0,
      reverse: 0,
      interact: false,
      handbrake: false,
    });

    simulation.stepMany(9);
    expect(simulation.world.controls.steer).toBe(0);
    expect(simulation.pendingCommands).toBe(1);

    simulation.step();
    expect(simulation.world.controls.steer).toBe(1);
    expect(simulation.pendingCommands).toBe(0);

    simulation.stepMany(60);
    expect(simulation.snapshot().vehicle.heading).toBeLessThan(0);
  });

  it('brakes to a stop through the command queue', () => {
    const simulation = new Simulation();
    simulation.stepMany(90);
    expect(simulation.snapshot().vehicle.speed).toBeGreaterThan(5);

    simulation.queueControls({ brake: 1 }, 91);
    simulation.stepMany(120);
    expect(simulation.snapshot().vehicle.speed).toBeLessThan(0.05);
  });

  it('is deterministic for the same config, commands and tick count', () => {
    const run = (): Simulation => {
      const simulation = new Simulation();
      simulation.queueCommand({ tick: 30, steer: -1, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: false });
      simulation.queueCommand({ tick: 90, steer: 0, throttle: 1, brake: 1, reverse: 0, interact: false, handbrake: false });
      simulation.queueCommand({ tick: 130, steer: 0, throttle: 1, brake: 0, reverse: 0, interact: false, handbrake: true });
      simulation.stepMany(600);
      return simulation;
    };

    const first = run();
    const second = run();

    expect(first.snapshot()).toEqual(second.snapshot());
    expect(JSON.parse(JSON.stringify(first.snapshot()))).toEqual(first.snapshot());
  });

  it('does not mutate previously returned snapshots', () => {
    const simulation = new Simulation();
    const before = simulation.snapshot();
    const beforeJson = JSON.stringify(before);

    simulation.stepMany(30);

    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(simulation.snapshot().tick).toBe(30);
  });

  it('advances game time and day phase over a long run', () => {
    const simulation = new Simulation();
    simulation.stepMany(GAME_CONFIG.fixedStepHz * 60);
    const snapshot = simulation.snapshot();

    expect(snapshot.elapsedSeconds).toBeCloseTo(60, 8);
    expect(snapshot.dayIndex).toBe(0);
    expect(snapshot.dayPhase).toBeCloseTo(0.1, 8);
  });

  it('validates stepMany arguments', () => {
    const simulation = new Simulation();
    expect(() => simulation.stepMany(-1)).toThrow(RangeError);
    expect(() => simulation.stepMany(1.5)).toThrow(RangeError);
    expect(simulation.time.tick).toBe(0);
  });

  it('exposes a seeded RNG for future systems', () => {
    const simulation = new Simulation();
    expect(simulation.rng.state).toBe(GAME_CONFIG.worldSeed >>> 0);
  });
});
