import { describe, expect, it } from 'vitest';
import { Vec2 } from '../src/core/math/Vec2';
import { createStructure, type BaseState } from '../src/sim/base/BaseState';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { RAID_CONFIG, validateRaidConfig, type RaidConfig } from '../src/data/raids';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { emptyAmounts } from '../src/sim/economy/EconomyState';
import { Simulation } from '../src/sim/Simulation';

/** Fast raid timings so scenarios run in a few simulated seconds. */
const FAST_RAIDS: RaidConfig = {
  ...RAID_CONFIG,
  firstDelaySeconds: 2,
  baseIntervalSeconds: 10,
  minIntervalSeconds: 5,
  countdownSeconds: 2,
  liveRadius: 40,
  baseRadius: 10,
  maxLiveSeconds: 12,
  lootPerAttackerOffline: 12,
  minStorageToRaid: 10,
  attackersBase: 2,
};

function createConfig(raids: RaidConfig = FAST_RAIDS): GameplayConfig {
  return {
    ...GAME_CONFIG,
    world: { ...GAME_CONFIG.world, halfWidth: 200, halfHeight: 200 },
    vehicle: {
      ...SCRAP_RUNNER,
      spawn: { x: 0, y: 0, headingRadians: 0 },
    },
    enemySpawns: [],
    spawnResourceNodes: [],
    raids,
  };
}

function baseOf(simulation: Simulation): BaseState {
  const base = simulation.world.bases[0];
  if (!base) throw new Error('expected a base');
  return base;
}

function parkVehicle(simulation: Simulation, x: number, y: number): void {
  simulation.world.vehicle = {
    ...simulation.world.vehicle,
    position: new Vec2(x, y),
    velocity: Vec2.ZERO,
  };
  simulation.queueControls({ brake: 1 }, 1);
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

function storageTotal(base: BaseState): number {
  return base.storage.scrap + base.storage.fuel + base.storage.water;
}

describe('raid config', () => {
  it('ships valid numbers', () => {
    expect(validateRaidConfig(RAID_CONFIG)).toEqual([]);
  });

  it('rejects impossible timings and radii', () => {
    expect(
      validateRaidConfig({
        ...RAID_CONFIG,
        firstDelaySeconds: 0,
        minIntervalSeconds: 900,
        baseIntervalSeconds: 400,
        baseRadius: 80,
        liveRadius: 40,
        attackersBase: 0,
      }),
    ).toEqual([
      'firstDelaySeconds must be a finite positive number',
      'attackersBase must be a positive integer',
      'minIntervalSeconds cannot exceed baseIntervalSeconds',
      'baseRadius must be smaller than liveRadius',
    ]);
  });
});

describe('planning', () => {
  it('does not raid a base without enough loot', () => {
    const simulation = new Simulation(createConfig());
    baseOf(simulation).storage = emptyAmounts();
    parkVehicle(simulation, 100, 100);

    simulation.stepMany(60 * 20);

    expect(simulation.world.raids).toHaveLength(0);
    expect(simulation.world.raidReports).toHaveLength(0);
  });

  it('schedules an incoming raid after the first delay', () => {
    const simulation = new Simulation(createConfig());
    baseOf(simulation).storage = { scrap: 100, fuel: 0, water: 0 };
    parkVehicle(simulation, 0, 0);

    simulation.stepMany(Math.ceil(FAST_RAIDS.firstDelaySeconds * 60) + 10);

    expect(simulation.world.raids).toHaveLength(1);
    expect(simulation.world.raids[0]?.phase).toBe('incoming');
    expect(simulation.world.raids[0]?.baseName).toBe(baseOf(simulation).name);
  });

  it('scales attackers with the number of bases', () => {
    const simulation = new Simulation(createConfig());
    baseOf(simulation).storage = { scrap: 100, fuel: 0, water: 0 };
    simulation.world.bases.push({
      ...baseOf(simulation),
      id: 'base-2',
      siteId: 'site-2',
      name: 'База 2',
      storage: { scrap: 100, fuel: 0, water: 0 },
      structures: [],
      scrappedCount: 0,
      minesSpent: 0,
      captured: false,
      foundedTick: 0,
    });
    parkVehicle(simulation, 0, 0);

    simulation.stepMany(Math.ceil(FAST_RAIDS.firstDelaySeconds * 60) + 10);

    expect(simulation.world.raids[0]?.attackers).toBe(
      FAST_RAIDS.attackersBase + FAST_RAIDS.attackersPerExtraBase,
    );
  });
});

describe('offline resolution', () => {
  it('loots an undefended base and reports it', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    base.storage = { scrap: 100, fuel: 0, water: 0 };
    // Player is far away, so the raid resolves abstractly.
    parkVehicle(simulation, 150, 150);

    simulation.stepMany(60 * 8);

    expect(simulation.world.raidReports.length).toBeGreaterThan(0);
    const report = simulation.world.raidReports.at(-1);
    expect(report?.live).toBe(false);
    expect(report?.outcome).toBe('looted');
    expect(report?.looted).toBeGreaterThan(0);
    expect(storageTotal(base)).toBeLessThan(100);
  });

  it('repels the raid when active turrets cover the attackers', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    base.storage = { scrap: 100, fuel: 500, water: 0 };
    addStructure(base, 'turret');
    addStructure(base, 'turret');
    parkVehicle(simulation, 150, 150);

    simulation.stepMany(60 * 8);

    const report = simulation.world.raidReports.at(-1);
    expect(report?.outcome).toBe('repelled');
    expect(report?.looted).toBe(0);
    expect(storageTotal(base)).toBeGreaterThanOrEqual(100);
  });

  it('never loots more than the base holds', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    base.storage = { scrap: 12, fuel: 0, water: 0 };
    parkVehicle(simulation, 150, 150);

    simulation.stepMany(60 * 20);

    expect(storageTotal(base)).toBeGreaterThanOrEqual(0);
    for (const report of simulation.world.raidReports) {
      expect(report.looted).toBeLessThanOrEqual(12);
    }
  });

  it('damages and eventually destroys structures', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    base.storage = { scrap: 100, fuel: 0, water: 0 };
    addStructure(base, 'depot');
    parkVehicle(simulation, 150, 150);

    simulation.stepMany(60 * 30);

    expect(base.scrappedCount + base.structures.length).toBeGreaterThanOrEqual(1);
    expect(
      simulation.world.raidReports.some((report) => report.structuresLost > 0),
    ).toBe(true);
  });

  it('captures a base stripped of everything', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    base.storage = { scrap: 20, fuel: 20, water: 20 };
    addStructure(base, 'depot');
    parkVehicle(simulation, 150, 150);

    simulation.stepMany(60 * 60);

    expect(base.captured || base.structures.length > 0).toBe(true);
    expect(storageTotal(base)).toBe(0);
  });
});

describe('live raids', () => {
  it('spawns attackers at the base when the player is nearby', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    base.storage = { scrap: 100, fuel: 0, water: 0 };
    parkVehicle(simulation, base.x + 5, base.y);

    simulation.stepMany(60 * 6);

    const raid = simulation.world.raids[0];
    expect(raid?.phase).toBe('active');
    const attackers = simulation.world.enemies.filter(
      (enemy) => enemy.raidId === raid?.id,
    );
    expect(attackers.length).toBe(raid?.attackers);
    for (const attacker of attackers) {
      expect(Math.hypot(attacker.position.x - base.x, attacker.position.y - base.y)).toBeLessThan(20);
    }
  });

  it('ends the raid once the attackers are destroyed', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    base.storage = { scrap: 100, fuel: 0, water: 0 };
    parkVehicle(simulation, base.x + 5, base.y);
    simulation.stepMany(60 * 6);
    const raidId = simulation.world.raids[0]?.id;
    expect(raidId).toBeDefined();

    // Kill every attacker outright.
    for (const enemy of simulation.world.enemies) {
      if (enemy.raidId === raidId) {
        enemy.health = 0;
        enemy.alive = false;
      }
    }
    simulation.step();

    expect(simulation.world.raids).toHaveLength(0);
    const report = simulation.world.raidReports.at(-1);
    expect(report?.live).toBe(true);
    expect(report?.outcome).toBe('repelled');
  });

  it('leaves with the loot when the live raid times out', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    base.storage = { scrap: 300, fuel: 0, water: 0 };
    parkVehicle(simulation, base.x + 5, base.y);

    // Planning delay + countdown + the live window, with a small margin.
    simulation.stepMany(
      Math.ceil(
        (FAST_RAIDS.firstDelaySeconds +
          FAST_RAIDS.countdownSeconds +
          FAST_RAIDS.maxLiveSeconds +
          6) *
          60,
      ),
    );

    const report = simulation.world.raidReports.at(-1);
    expect(report?.live).toBe(true);
    expect(report?.outcome).toBe('looted');
    expect(simulation.world.enemies.filter((enemy) => enemy.raidId !== null)).toHaveLength(0);
    expect(storageTotal(base)).toBeLessThan(300);
  });

  it('keeps the report log bounded', () => {
    const simulation = new Simulation(createConfig());
    baseOf(simulation).storage = { scrap: 4000, fuel: 4000, water: 4000 };
    parkVehicle(simulation, 150, 150);

    simulation.stepMany(60 * 120);

    expect(simulation.world.raidReports.length).toBeLessThanOrEqual(5);
  });

  it('is deterministic for the same seed and timings', () => {
    const run = (): string => {
      const simulation = new Simulation(createConfig());
      const base = baseOf(simulation);
      base.storage = { scrap: 200, fuel: 50, water: 50 };
      addStructure(base, 'turret');
      parkVehicle(simulation, 150, 150);
      simulation.stepMany(60 * 40);
      return JSON.stringify({
        storage: base.storage,
        structures: base.structures.length,
        reports: simulation.world.raidReports.map((report) => ({
          outcome: report.outcome,
          looted: report.looted,
          lost: report.structuresLost,
        })),
      });
    };

    expect(run()).toBe(run());
  });

  it('exposes raids and reports in the snapshot', () => {
    const simulation = new Simulation(createConfig());
    baseOf(simulation).storage = { scrap: 100, fuel: 0, water: 0 };
    parkVehicle(simulation, 150, 150);
    simulation.stepMany(60 * 8);

    const snapshot = simulation.snapshot().baseState;
    expect(snapshot.reports.length).toBeGreaterThan(0);
    expect(snapshot.bases[0]?.captured).toBe(false);
  });
});
