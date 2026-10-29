import { describe, expect, it } from 'vitest';
import {
  ECONOMY_CONFIG,
  STRUCTURE_ECONOMY,
  validateEconomyConfig,
  validateStructureEconomy,
} from '../src/data/economy';
import { STRUCTURE_KINDS, type StructureKind } from '../src/data/bases';
import { Vec2 } from '../src/core/math/Vec2';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { createStructure, type BaseState } from '../src/sim/base/BaseState';
import { emptyAmounts } from '../src/sim/economy/EconomyState';
import { Simulation } from '../src/sim/Simulation';
import { baseEconomyRates } from '../src/sim/systems/EconomySystem';

function createConfig(): GameplayConfig {
  return {
    ...GAME_CONFIG,
    world: { ...GAME_CONFIG.world, halfWidth: 200, halfHeight: 200 },
    vehicle: {
      ...SCRAP_RUNNER,
      spawn: { x: 0, y: 0, headingRadians: 0 },
    },
    enemySpawns: [],
  };
}

/** Simulation with one base holding only the given structures. */
function withStructures(
  kinds: readonly StructureKind[],
  storage = emptyAmounts(),
): { simulation: Simulation; base: BaseState } {
  const simulation = new Simulation(createConfig());
  const base = simulation.world.bases[0]!;
  base.structures = kinds.map((kind, index) =>
    createStructure({
      id: `s${index}`,
      kind,
      x: base.x,
      y: base.y,
      slotIndex: index,
      builtTick: 0,
      maxCondition: ECONOMY_CONFIG.maxCondition,
    }),
  );
  base.storage = { ...storage };
  // Keep the car at the base so its economy runs on the full 60 Hz path; the
  // remote cadence is covered by its own tests.
  simulation.world.vehicle = {
    ...simulation.world.vehicle,
    position: new Vec2(base.x, base.y),
    velocity: Vec2.ZERO,
  };
  simulation.queueControls({ brake: 1 }, 1);
  return { simulation, base };
}

/** Runs `seconds` of simulation time at the fixed step. */
function run(simulation: Simulation, seconds: number): void {
  simulation.stepMany(Math.round(seconds * GAME_CONFIG.fixedStepHz));
}

describe('economy config', () => {
  it('ships valid config and structure economy', () => {
    expect(validateEconomyConfig(ECONOMY_CONFIG)).toEqual([]);
    expect(validateStructureEconomy(STRUCTURE_ECONOMY)).toEqual([]);
  });

  it('defines upkeep and production for every structure kind', () => {
    for (const kind of STRUCTURE_KINDS) {
      expect(STRUCTURE_ECONOMY[kind]).toBeDefined();
    }
  });

  it('rejects invalid numbers', () => {
    expect(
      validateEconomyConfig({ maxCondition: 0, degradationSeconds: 0, graceSeconds: -1 }),
    ).toEqual([
      'maxCondition must be a positive integer',
      'degradationSeconds must be a finite positive number',
      'graceSeconds must be a finite non-negative number',
    ]);

    expect(
      validateStructureEconomy({
        depot: { upkeep: { scrap: -1 }, production: {} },
      }),
    ).toEqual(['depot.upkeep.scrap must be a finite non-negative number']);
  });
});

describe('upkeep', () => {
  it('charges whole units as the fractional upkeep accrues', () => {
    const { simulation, base } = withStructures(['depot'], {
      scrap: 60,
      fuel: 0,
      water: 0,
    });

    // Depot upkeep is 0.5 scrap/min: one minute accrues half a unit and
    // charges nothing, four minutes charge exactly two.
    run(simulation, 60);
    expect(base.storage.scrap).toBe(60);

    run(simulation, 180);
    expect(base.storage.scrap).toBe(58);
  });

  it('spends exactly the fractional rate over a long window', () => {
    const { simulation, base } = withStructures(['depot'], {
      scrap: 100,
      fuel: 0,
      water: 0,
    });

    run(simulation, 120); // two minutes, 0.5/min => 1 unit

    expect(base.storage.scrap).toBe(99);
    expect(base.structures[0]?.active).toBe(true);
  });
});

describe('production', () => {
  it('adds generated resources to the base storage', () => {
    const { simulation, base } = withStructures(['generator'], {
      scrap: 0,
      fuel: 100,
      water: 0,
    });

    run(simulation, 120); // generator: upkeep 1 fuel/min, production 3 fuel/min

    // Net +2 fuel/min over two minutes, with integer transfers.
    expect(base.storage.fuel).toBe(100 - 2 + 6);
    expect(base.structures[0]?.producedTotal).toBe(6);
  });

  it('reports net rates per minute for the HUD', () => {
    const { base } = withStructures(['generator']);
    const rates = baseEconomyRates(base);

    expect(rates.upkeepPerMinute.fuel).toBeCloseTo(1, 10);
    expect(rates.productionPerMinute.fuel).toBeCloseTo(3, 10);
    expect(rates.netPerMinute.fuel).toBeCloseTo(2, 10);
    expect(rates.inactiveStructures).toBe(0);
  });
});

describe('deficit and degradation', () => {
  it('marks a structure inactive when upkeep cannot be paid', () => {
    const { simulation, base } = withStructures(['turret'], {
      scrap: 0,
      fuel: 0,
      water: 0,
    });

    run(simulation, 2);

    expect(base.structures[0]?.active).toBe(false);
    expect(base.storage.fuel).toBe(0);
    expect(baseEconomyRates(base).inactiveStructures).toBe(1);
  });

  it('stops production while inactive', () => {
    const { simulation, base } = withStructures(['generator'], emptyAmounts());

    run(simulation, 60);

    expect(base.structures[0]?.active).toBe(false);
    expect(base.structures[0]?.producedTotal).toBe(0);
    expect(base.storage.fuel).toBe(0);
  });

  it('scraps a structure that stays in deficit past the grace period', () => {
    const { simulation, base } = withStructures(['turret'], emptyAmounts());

    const condition = ECONOMY_CONFIG.maxCondition;
    const untilScrapped =
      ECONOMY_CONFIG.graceSeconds + ECONOMY_CONFIG.degradationSeconds * condition + 5;
    run(simulation, untilScrapped);

    expect(base.structures).toHaveLength(0);
    expect(base.scrappedCount).toBe(1);
  });

  it('loses condition gradually instead of vanishing at once', () => {
    const { simulation, base } = withStructures(['turret'], emptyAmounts());

    run(simulation, ECONOMY_CONFIG.graceSeconds + ECONOMY_CONFIG.degradationSeconds + 2);

    expect(base.structures).toHaveLength(1);
    expect(base.structures[0]?.condition).toBe(ECONOMY_CONFIG.maxCondition - 1);
  });

  it('recovers and pays again once storage is refilled', () => {
    const { simulation, base } = withStructures(['turret'], emptyAmounts());
    run(simulation, ECONOMY_CONFIG.graceSeconds + 5);
    expect(base.structures[0]?.active).toBe(false);

    base.storage.fuel = 50;
    run(simulation, 60);

    const structure = base.structures[0];
    expect(structure?.active).toBe(true);
    expect(structure?.deficitSeconds).toBe(0);
    expect(base.storage.fuel).toBeLessThan(50);
  });

  it('never drives storage negative', () => {
    const { simulation, base } = withStructures(
      ['depot', 'workshop', 'turret', 'generator'],
      { scrap: 3, fuel: 2, water: 1 },
    );

    for (let tick = 0; tick < 60 * 300; tick += 1) {
      simulation.step();
      expect(base.storage.scrap).toBeGreaterThanOrEqual(0);
      expect(base.storage.fuel).toBeGreaterThanOrEqual(0);
      expect(base.storage.water).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('long runs', () => {
  it('is deterministic across ten simulated minutes', () => {
    const runOnce = (): string => {
      const { simulation, base } = withStructures(
        ['depot', 'workshop', 'turret', 'generator'],
        { scrap: 30, fuel: 25, water: 10 },
      );
      run(simulation, 600);
      return JSON.stringify({
        storage: base.storage,
        structures: base.structures.map((structure) => ({
          kind: structure.kind,
          active: structure.active,
          condition: structure.condition,
          produced: structure.producedTotal,
        })),
        scrapped: base.scrappedCount,
      });
    };

    expect(runOnce()).toBe(runOnce());
  });

  it('reaches a stable deficit state without runaway numbers', () => {
    const { simulation, base } = withStructures(['depot', 'turret'], {
      scrap: 5,
      fuel: 0,
      water: 0,
    });

    run(simulation, 900); // 15 minutes

    expect(base.storage.scrap).toBeGreaterThanOrEqual(0);
    expect(base.storage.fuel).toBe(0);
    expect(base.structures.length).toBeLessThanOrEqual(2);
    expect(base.scrappedCount).toBeLessThanOrEqual(2);
  });

  it('keeps a self-sufficient generator base alive indefinitely', () => {
    const { simulation, base } = withStructures(['generator'], {
      scrap: 0,
      fuel: 10,
      water: 0,
    });

    run(simulation, 600);

    expect(base.structures).toHaveLength(1);
    expect(base.structures[0]?.active).toBe(true);
    expect(base.storage.fuel).toBeGreaterThan(10);
  });

  it('exposes economy rates and condition in the snapshot', () => {
    const { simulation } = withStructures(['generator'], {
      scrap: 0,
      fuel: 50,
      water: 0,
    });
    run(simulation, 120);

    const snapshot = simulation.snapshot();
    const base = snapshot.baseState.bases[0];
    expect(base?.economy.netPerMinute.fuel).toBeCloseTo(2, 10);
    expect(base?.structures[0]?.condition).toBe(ECONOMY_CONFIG.maxCondition);
    expect(base?.structures[0]?.active).toBe(true);
  });
});
