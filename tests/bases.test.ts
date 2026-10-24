import { describe, expect, it } from 'vitest';
import {
  BASE_CONFIG,
  BASE_SLOTS,
  STRUCTURE_DEFINITIONS,
  STRUCTURE_KINDS,
  validateBaseConfig,
  validateStructureDefinitions,
} from '../src/data/bases';
import { Vec2 } from '../src/core/math/Vec2';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import {
  canAfford,
  payCost,
  storageTotal,
  validatePlacement,
  type BaseState,
} from '../src/sim/base/BaseState';
import { emptyAmounts, type ResourceAmounts } from '../src/sim/economy/EconomyState';
import { Simulation } from '../src/sim/Simulation';

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

function makeBase(overrides: Partial<BaseState> = {}): BaseState {
  return {
    id: 'base-test',
    siteId: 'site-test',
    name: 'Тест',
    x: 0,
    y: 0,
    storage: emptyAmounts(),
    structures: [],
    foundedTick: 0,
    ...overrides,
  };
}

function richCargo(): ResourceAmounts {
  return { scrap: 1000, fuel: 1000, water: 1000 };
}

/** Puts the car on the starter pad and tops up its cargo. */
function startAtBase(): Simulation {
  const simulation = new Simulation(createConfig());
  const base = simulation.world.bases[0];
  if (!base) throw new Error('expected starter base');

  simulation.world.vehicle = {
    ...simulation.world.vehicle,
    position: new Vec2(base.x, base.y),
    velocity: Vec2.ZERO,
  };
  simulation.world.economy.cargo = richCargo();
  return simulation;
}

function pressBuild(simulation: Simulation, tick: number): void {
  const previous = simulation.world.controls.buildToken;
  simulation.queueControls({ brake: 1, buildToken: previous + 1 }, tick);
}

describe('base config', () => {
  it('ships valid config and structure definitions', () => {
    expect(validateBaseConfig(BASE_CONFIG)).toEqual([]);
    expect(validateStructureDefinitions(STRUCTURE_DEFINITIONS)).toEqual([]);
  });

  it('keeps the per-base cap within the slot count', () => {
    expect(BASE_CONFIG.maxStructuresPerBase).toBeLessThanOrEqual(BASE_SLOTS.length);
    const errors = validateBaseConfig({
      ...BASE_CONFIG,
      maxStructuresPerBase: BASE_SLOTS.length + 1,
    });
    expect(errors).toContain('maxStructuresPerBase cannot exceed the number of slots');
  });

  it('gives every structure a cost and a limit', () => {
    for (const kind of STRUCTURE_KINDS) {
      const definition = STRUCTURE_DEFINITIONS[kind];
      expect(definition.limitPerBase).toBeGreaterThan(0);
      expect(Object.values(definition.cost).some((amount) => (amount ?? 0) > 0)).toBe(
        true,
      );
    }
  });
});

describe('resource payments', () => {
  it('pays only when the cargo covers the full cost', () => {
    const cargo: ResourceAmounts = { scrap: 10, fuel: 0, water: 0 };
    expect(canAfford(cargo, { scrap: 20 })).toBe(false);
    expect(payCost(cargo, { scrap: 20 })).toBe(false);
    expect(cargo.scrap).toBe(10);

    expect(payCost(cargo, { scrap: 4 })).toBe(true);
    expect(cargo).toEqual({ scrap: 6, fuel: 0, water: 0 });
  });

  it('requires every listed resource at once', () => {
    const cargo: ResourceAmounts = { scrap: 99, fuel: 1, water: 0 };
    expect(canAfford(cargo, { scrap: 40, water: 5 })).toBe(false);
    expect(payCost(cargo, { scrap: 40, water: 5 })).toBe(false);
    // Nothing is deducted from a failed payment.
    expect(cargo).toEqual({ scrap: 99, fuel: 1, water: 0 });
  });
});

describe('placement validation', () => {
  it('accepts the first structure and uses slot 0', () => {
    const verdict = validatePlacement(makeBase(), 'depot', richCargo());
    expect(verdict.ok).toBe(true);
    expect(verdict.slotIndex).toBe(0);
  });

  it('rejects a second structure of the same kind', () => {
    const base = makeBase();
    base.structures.push({
      id: 's1',
      kind: 'depot',
      x: 0,
      y: 0,
      slotIndex: 0,
      builtTick: 0,
    });
    expect(validatePlacement(base, 'depot', richCargo())).toEqual({
      ok: false,
      reason: 'ЛИМИТ',
      slotIndex: -1,
    });
  });

  it('allows a second turret but not a third', () => {
    const base = makeBase();
    for (let index = 0; index < 2; index += 1) {
      base.structures.push({
        id: `t${index}`,
        kind: 'turret',
        x: 0,
        y: 0,
        slotIndex: index,
        builtTick: 0,
      });
    }
    expect(validatePlacement(base, 'turret', richCargo()).reason).toBe('ЛИМИТ');
  });

  it('rejects when the player cannot pay', () => {
    expect(validatePlacement(makeBase(), 'workshop', emptyAmounts())).toEqual({
      ok: false,
      reason: 'НЕ ХВАТАЕТ РЕСУРСОВ',
      slotIndex: -1,
    });
  });

  it('rejects when every slot is taken', () => {
    const base = makeBase();
    for (let index = 0; index < BASE_SLOTS.length; index += 1) {
      base.structures.push({
        id: `s${index}`,
        kind: 'turret',
        x: 0,
        y: 0,
        slotIndex: index,
        builtTick: 0,
      });
    }
    expect(validatePlacement(base, 'generator', richCargo()).reason).toBe('НЕТ МЕСТА');
  });

  it('never puts two structures in the same slot', () => {
    const base = makeBase();
    const cargo = richCargo();
    const used = new Set<number>();

    for (const kind of ['depot', 'workshop', 'turret', 'turret', 'generator'] as const) {
      const verdict = validatePlacement(base, kind, cargo);
      expect(verdict.ok).toBe(true);
      expect(used.has(verdict.slotIndex)).toBe(false);
      used.add(verdict.slotIndex);
      base.structures.push({
        id: `s${used.size}`,
        kind,
        x: 0,
        y: 0,
        slotIndex: verdict.slotIndex,
        builtTick: 0,
      });
    }
  });
});

describe('building in the simulation', () => {
  it('builds the first structure for cargo and records it', () => {
    const simulation = startAtBase();
    const base = simulation.world.bases[0]!;
    const scrapBefore = simulation.world.economy.cargo.scrap;

    pressBuild(simulation, 2);
    simulation.stepMany(3);

    expect(base.structures).toHaveLength(1);
    expect(base.structures[0]?.kind).toBe('depot');
    expect(simulation.world.economy.cargo.scrap).toBe(
      scrapBefore - (STRUCTURE_DEFINITIONS.depot.cost.scrap ?? 0),
    );
    // The structure sits on the pad, not at the car.
    expect(Math.hypot(base.structures[0]!.x - base.x, base.structures[0]!.y - base.y)).toBeLessThan(3);
  });

  it('builds once per key press even when the command repeats', () => {
    const simulation = startAtBase();
    const base = simulation.world.bases[0]!;

    simulation.queueControls({ brake: 1, buildToken: 1 }, 2);
    simulation.stepMany(30); // same token persists across ticks

    expect(base.structures).toHaveLength(1);

    simulation.queueControls({ brake: 1, buildToken: 2 }, 32);
    simulation.stepMany(3);
    expect(base.structures).toHaveLength(2);
  });

  it('does not build without resources', () => {
    const simulation = startAtBase();
    simulation.world.economy.cargo = emptyAmounts();

    pressBuild(simulation, 2);
    simulation.stepMany(3);

    expect(simulation.world.bases[0]?.structures).toHaveLength(0);
  });

  it('does not build away from any base', () => {
    const simulation = startAtBase();
    simulation.world.vehicle = {
      ...simulation.world.vehicle,
      position: new Vec2(120, 120),
      velocity: Vec2.ZERO,
    };

    pressBuild(simulation, 2);
    simulation.stepMany(3);

    expect(simulation.world.bases[0]?.structures).toHaveLength(0);
  });

  it('stops at the per-kind limits and never exceeds the base cap', () => {
    const simulation = startAtBase();
    const base = simulation.world.bases[0]!;
    simulation.world.economy.cargo = { scrap: 5000, fuel: 5000, water: 5000 };

    for (let press = 1; press <= 12; press += 1) {
      simulation.queueControls({ brake: 1, buildToken: press }, press * 4);
      simulation.stepMany(4);
    }

    // Per-kind limits (1 depot + 1 workshop + 2 turrets + 1 generator) run out
    // before the total cap, so this is the real ceiling.
    const perKindTotal = STRUCTURE_KINDS.reduce(
      (sum, kind) => sum + STRUCTURE_DEFINITIONS[kind].limitPerBase,
      0,
    );
    expect(base.structures.length).toBe(
      Math.min(perKindTotal, BASE_CONFIG.maxStructuresPerBase),
    );

    const world = simulation.world;
    for (const kind of STRUCTURE_KINDS) {
      const count = base.structures.filter((structure) => structure.kind === kind).length;
      expect(count).toBeLessThanOrEqual(STRUCTURE_DEFINITIONS[kind].limitPerBase);
    }
    // Every structure has its own slot.
    const slots = new Set(base.structures.map((structure) => structure.slotIndex));
    expect(slots.size).toBe(base.structures.length);
    expect(world.bases[0]?.structures).toBe(base.structures);
  });
});

describe('founding new bases', () => {
  it('founds a base on an unclaimed pad for scrap', () => {
    const simulation = startAtBase();
    simulation.world.economy.cargo = richCargo();
    // A prepared pad next to the car (which stands on the starter pad).
    const base = simulation.world.bases[0]!;
    simulation.world.baseSites = [{ id: 'site-near', x: base.x + 4, y: base.y }];

    const before = simulation.world.bases.length;
    simulation.queueControls({ brake: 1, foundBaseToken: 1 }, 2);
    simulation.stepMany(3);

    expect(simulation.world.bases).toHaveLength(before + 1);
    const founded = simulation.world.bases[before]!;
    expect(founded.siteId).toBe('site-near');
    expect(founded.x).toBe(simulation.world.bases[0]!.x + 4);
  });

  it('refuses to found a second base on the same pad', () => {
    const simulation = startAtBase();
    simulation.world.economy.cargo = richCargo();
    const base = simulation.world.bases[0]!;
    simulation.world.baseSites = [{ id: 'site-near', x: base.x + 4, y: base.y }];

    simulation.queueControls({ brake: 1, foundBaseToken: 1 }, 2);
    simulation.stepMany(3);
    const count = simulation.world.bases.length;

    simulation.queueControls({ brake: 1, foundBaseToken: 2 }, 6);
    simulation.stepMany(3);

    expect(simulation.world.bases).toHaveLength(count);
  });

  it('cannot found a base without scrap', () => {
    const simulation = startAtBase();
    simulation.world.economy.cargo = emptyAmounts();
    const base = simulation.world.bases[0]!;
    simulation.world.baseSites = [{ id: 'site-near', x: base.x + 4, y: base.y }];

    simulation.queueControls({ brake: 1, foundBaseToken: 1 }, 2);
    simulation.stepMany(3);

    expect(simulation.world.bases).toHaveLength(1);
  });

  it('keeps storages independent between bases', () => {
    const simulation = startAtBase();
    const base = simulation.world.bases[0]!;
    simulation.world.baseSites = [{ id: 'site-near', x: base.x + 4, y: base.y }];
    simulation.world.economy.cargo = { scrap: 60, fuel: 0, water: 0 };

    simulation.queueControls({ brake: 1, foundBaseToken: 1 }, 2);
    simulation.stepMany(3);

    const [starter, founded] = simulation.world.bases;
    expect(starter && founded).toBeTruthy();
    starter!.storage.scrap = 10;
    founded!.storage.scrap = 25;

    expect(storageTotal(starter!)).toBe(10);
    expect(storageTotal(founded!)).toBe(25);
  });

  it('cycles the HUD focus between bases', () => {
    const simulation = startAtBase();
    const base = simulation.world.bases[0]!;
    simulation.world.baseSites = [{ id: 'site-near', x: base.x + 4, y: base.y }];
    simulation.world.economy.cargo = richCargo();

    simulation.queueControls({ brake: 1, foundBaseToken: 1 }, 2);
    simulation.stepMany(3);

    expect(simulation.world.bases).toHaveLength(2);
    const first = simulation.world.selectedBaseIndex;

    simulation.queueControls({ brake: 1, cycleBaseToken: 1 }, 6);
    simulation.stepMany(3);

    expect(simulation.world.selectedBaseIndex).not.toBe(first);
  });

  it('is deterministic for the same commands', () => {
    const run = (): string => {
      const simulation = startAtBase();
      const base = simulation.world.bases[0]!;
    simulation.world.baseSites = [{ id: 'site-near', x: base.x + 4, y: base.y }];
      simulation.queueControls({ brake: 1, foundBaseToken: 1 }, 2);
      simulation.stepMany(4);
      simulation.queueControls({ brake: 1, buildToken: 1 }, 8);
      simulation.stepMany(10);
      return JSON.stringify(simulation.snapshot().baseState);
    };

    expect(run()).toBe(run());
  });

  it('exposes bases and their structures in the snapshot', () => {
    const simulation = startAtBase();
    pressBuild(simulation, 2);
    simulation.stepMany(3);

    const snapshot = simulation.snapshot();
    expect(snapshot.baseState.bases).toHaveLength(1);
    expect(snapshot.baseState.bases[0]?.structures).toHaveLength(1);
    expect(snapshot.baseState.bases[0]?.selected).toBe(true);
    expect(snapshot.baseState.bases[0]?.name).toBe('Лагерь');
  });
});
