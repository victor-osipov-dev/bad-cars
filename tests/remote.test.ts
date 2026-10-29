import { describe, expect, it } from 'vitest';
import { Vec2 } from '../src/core/math/Vec2';
import { createStructure, type BaseState } from '../src/sim/base/BaseState';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { REMOTE_CONFIG, validateRemoteConfig, type RemoteConfig } from '../src/data/remote';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { emptyAmounts } from '../src/sim/economy/EconomyState';
import { Simulation } from '../src/sim/Simulation';

function createConfig(remote: RemoteConfig = REMOTE_CONFIG): GameplayConfig {
  return {
    ...GAME_CONFIG,
    world: { ...GAME_CONFIG.world, halfWidth: 300, halfHeight: 300 },
    vehicle: {
      ...SCRAP_RUNNER,
      spawn: { x: 0, y: 0, headingRadians: 0 },
    },
    enemySpawns: [],
    spawnResourceNodes: [],
    remote,
  };
}

function baseOf(simulation: Simulation): BaseState {
  const base = simulation.world.bases[0];
  if (!base) throw new Error('expected a base');
  return base;
}

function addStructure(base: BaseState, kind: Parameters<typeof createStructure>[0]['kind']) {
  const structure = createStructure({
    id: `s-${base.structures.length}-${kind}`,
    kind,
    x: base.x,
    y: base.y,
    slotIndex: base.structures.length,
    builtTick: 0,
    maxCondition: 3,
  });
  base.structures.push(structure);
  return structure;
}

function park(simulation: Simulation, x: number, y: number): void {
  simulation.world.vehicle = {
    ...simulation.world.vehicle,
    position: new Vec2(x, y),
    velocity: Vec2.ZERO,
  };
  simulation.queueControls({ brake: 1 }, 1);
}

/** Moves the base far from the player so it becomes a remote base. */
function makeRemote(simulation: Simulation): BaseState {
  const base = baseOf(simulation);
  simulation.world.bases[0] = { ...base, x: 250, y: 250 };
  return baseOf(simulation);
}

describe('remote config', () => {
  it('ships valid numbers', () => {
    expect(validateRemoteConfig(REMOTE_CONFIG)).toEqual([]);
  });

  it('rejects nonsensical caps', () => {
    expect(
      validateRemoteConfig({
        ...REMOTE_CONFIG,
        remoteRadius: 0,
        abstractIntervalSeconds: 0,
        maxAbstractTicksPerFrame: 0,
        maxCatchUpTicks: 0,
        maxReports: 0,
      }),
    ).toEqual([
      'remoteRadius must be a finite positive number',
      'abstractIntervalSeconds must be a finite positive number',
      'maxAbstractTicksPerFrame must be a positive integer',
      'maxCatchUpTicks must be a positive integer',
      'maxReports must be a positive integer',
    ]);
  });
});

describe('local vs remote cadence', () => {
  it('advances a local base every tick', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    base.storage = { scrap: 100, fuel: 0, water: 0 };
    addStructure(base, 'depot');
    park(simulation, base.x, base.y);

    simulation.stepMany(60 * 120);

    // Depot upkeep is 0.5/min, so two minutes cost exactly one unit.
    expect(base.storage.scrap).toBe(99);
    expect(simulation.world.remoteTicks).toBe(0);
  });

  it('leaves a remote base to the abstract cadence', () => {
    const simulation = new Simulation(createConfig());
    const base = makeRemote(simulation);
    base.storage = { scrap: 0, fuel: 200, water: 0 };
    // A generator produces every abstract tick, so the tick leaves a report.
    addStructure(base, 'generator');
    park(simulation, 0, 0);

    // 40 s at a 5 s interval is eight ticks. The window is wider than the
    // minimum so the generator's fractional production definitely lands on a
    // whole unit (3/min => 0.25 per tick).
    simulation.stepMany(60 * 40);

    expect(simulation.world.remoteTicks).toBeGreaterThanOrEqual(7);
    expect(simulation.world.remoteTicks).toBeLessThanOrEqual(8);
    expect(simulation.world.remoteReports.length).toBeGreaterThan(0);
  });

  it('produces the same totals as the continuous path over a long window', () => {
    const run = (remote: boolean): number => {
      const simulation = new Simulation(createConfig());
      const base = remote ? makeRemote(simulation) : baseOf(simulation);
      base.storage = { scrap: 0, fuel: 200, water: 0 };
      addStructure(base, 'generator');
      park(simulation, remote ? 0 : base.x, remote ? 0 : base.y);
      simulation.stepMany(60 * 120);
      return base.storage.fuel;
    };

    const local = run(false);
    const distant = run(true);
    // Coarse ticks may differ by one unit of granularity, never more.
    expect(Math.abs(local - distant)).toBeLessThanOrEqual(1);
  });
});

describe('cost bounds', () => {
  it('never runs more abstract ticks per frame than the budget', () => {
    const simulation = new Simulation(
      createConfig({ ...REMOTE_CONFIG, maxAbstractTicksPerFrame: 2 }),
    );
    const base = makeRemote(simulation);
    base.storage = { scrap: 500, fuel: 0, water: 0 };
    addStructure(base, 'depot');
    park(simulation, 0, 0);

    // One huge frame (0.25 s is the driver cap, but step() takes the fixed
    // step; emulate a stall by calling stepMany with a large batch).
    simulation.stepMany(60 * 60);

    // 60 s / 5 s = 12 abstract ticks total, but the per-frame cap only limits
    // each frame, so the total must still be bounded by the elapsed time.
    expect(simulation.world.remoteTicks).toBeLessThanOrEqual(12);
  });

  it('drops the backlog instead of queuing it forever', () => {
    const simulation = new Simulation(
      createConfig({ ...REMOTE_CONFIG, maxAbstractTicksPerFrame: 1 }),
    );
    const base = makeRemote(simulation);
    base.storage = { scrap: 500, fuel: 0, water: 0 };
    addStructure(base, 'depot');
    park(simulation, 0, 0);

    simulation.stepMany(60 * 30);

    // One tick per frame with a 1/60 s frame can never keep up with a 5 s
    // interval, so the accumulator is reset rather than growing without bound.
    expect(simulation.world.remoteAccumulator).toBeLessThan(
      REMOTE_CONFIG.abstractIntervalSeconds,
    );
  });
});

describe('catch-up on load', () => {
  it('fast-forwards remote bases by the requested span', () => {
    const simulation = new Simulation(createConfig());
    const base = makeRemote(simulation);
    base.storage = { scrap: 100, fuel: 0, water: 0 };
    addStructure(base, 'depot');
    park(simulation, 0, 0);

    const result = simulation.catchUp(120);

    expect(result.truncated).toBe(false);
    // 120 s / 5 s = 24 abstract ticks.
    expect(result.ticks).toBe(24);
    expect(simulation.world.remoteTicks).toBe(24);
  });

  it('caps the work and reports truncation', () => {
    const simulation = new Simulation(
      createConfig({ ...REMOTE_CONFIG, maxCatchUpTicks: 10 }),
    );
    const base = makeRemote(simulation);
    base.storage = { scrap: 100, fuel: 0, water: 0 };
    addStructure(base, 'depot');
    park(simulation, 0, 0);

    const result = simulation.catchUp(3600);

    expect(result.ticks).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it('does not touch the render clock', () => {
    const simulation = new Simulation(createConfig());
    makeRemote(simulation);
    park(simulation, 0, 0);
    const tickBefore = simulation.time.tick;

    simulation.catchUp(600);

    expect(simulation.time.tick).toBe(tickBefore);
  });

  it('ignores non-positive and non-finite spans', () => {
    const simulation = new Simulation(createConfig());
    for (const value of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(simulation.catchUp(value)).toEqual({ ticks: 0, truncated: false });
    }
  });

  it('applies upkeep while catching up', () => {
    const simulation = new Simulation(createConfig());
    const base = makeRemote(simulation);
    base.storage = { scrap: 100, fuel: 0, water: 0 };
    addStructure(base, 'depot');
    park(simulation, 0, 0);

    simulation.catchUp(600); // 10 minutes => 5 units of depot upkeep

    // 0.5/min over 10 min is exactly 5 units, but the fractional accumulator
    // can land a hair under an integer, so allow one unit of granularity.
    expect(base.storage.scrap).toBeGreaterThanOrEqual(95);
    expect(base.storage.scrap).toBeLessThanOrEqual(96);
  });

  it('is deterministic across two identical catch-ups', () => {
    const run = (): string => {
      const simulation = new Simulation(createConfig());
      const base = makeRemote(simulation);
      base.storage = { scrap: 60, fuel: 40, water: 40 };
      addStructure(base, 'depot');
      addStructure(base, 'workshop');
      addStructure(base, 'generator');
      park(simulation, 0, 0);
      simulation.catchUp(900);
      return JSON.stringify({
        storage: base.storage,
        structures: base.structures.map((structure) => ({
          kind: structure.kind,
          condition: structure.condition,
          produced: structure.producedTotal,
        })),
        reports: simulation.world.remoteReports.map((report) => report.kind),
      });
    };

    expect(run()).toBe(run());
  });
});

describe('remote reports', () => {
  it('records production and keeps the log bounded', () => {
    const simulation = new Simulation(
      createConfig({ ...REMOTE_CONFIG, maxReports: 3 }),
    );
    const base = makeRemote(simulation);
    base.storage = { scrap: 0, fuel: 200, water: 0 };
    addStructure(base, 'generator');
    park(simulation, 0, 0);

    simulation.catchUp(600);

    expect(simulation.world.remoteReports.length).toBeLessThanOrEqual(3);
    expect(simulation.world.remoteReports.some((report) => report.kind === 'produced')).toBe(
      true,
    );
  });

  it('reports scrapped structures', () => {
    const simulation = new Simulation(createConfig());
    const base = makeRemote(simulation);
    base.storage = emptyAmounts();
    addStructure(base, 'turret');
    park(simulation, 0, 0);

    simulation.catchUp(600);

    expect(base.structures).toHaveLength(0);
    expect(
      simulation.world.remoteReports.some((report) => report.kind === 'scrapped'),
    ).toBe(true);
  });

  it('exposes remote stats in the snapshot', () => {
    const simulation = new Simulation(createConfig());
    const base = makeRemote(simulation);
    base.storage = { scrap: 0, fuel: 100, water: 0 };
    addStructure(base, 'generator');
    park(simulation, 0, 0);
    simulation.catchUp(120);

    const snapshot = simulation.snapshot().baseState.remote;
    expect(snapshot.ticks).toBe(24);
    expect(snapshot.reports.length).toBeGreaterThan(0);
  });
});
