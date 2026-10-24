import { describe, expect, it } from 'vitest';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import type { EnemySpawn } from '../src/data/enemies';
import {
  INVENTORY_CONFIG,
  RESOURCE_DEFINITIONS,
  RESOURCE_KINDS,
  validateInventoryConfig,
  validateResourceDefinitions,
  type ResourceKind,
} from '../src/data/resources';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { Simulation } from '../src/sim/Simulation';

interface Options {
  readonly cargoCapacity?: number;
  readonly enemySpawns?: readonly EnemySpawn[];
  readonly worldHalf?: number;
}

function createConfig(options: Options = {}): GameplayConfig {
  return {
    ...GAME_CONFIG,
    world: {
      ...GAME_CONFIG.world,
      halfWidth: options.worldHalf ?? 200,
      halfHeight: options.worldHalf ?? 200,
    },
    vehicle: {
      ...SCRAP_RUNNER,
      spawn: { x: 0, y: 0, headingRadians: 0 },
    },
    enemySpawns: options.enemySpawns ?? [],
  };
}

/**
 * Builds a sim with a single resource node placed next to the car and the
 * depot far away, so harvesting is the only possible interaction.
 */
function createHarvestSim(options: Options & { kind?: ResourceKind; amount?: number } = {}) {
  const kind = options.kind ?? 'scrap';
  const amount = options.amount ?? 10;
  const simulation = new Simulation(createConfig(options));

  // Replace the procedural nodes with one controlled node right next to us.
  simulation.world.resourceNodes = [
    {
      id: 'test-node',
      kind,
      x: 1.5,
      y: 0,
      maxAmount: amount,
      remaining: amount,
    },
  ];
  moveBaseAway(simulation);
  simulation.world.economy.cargoCapacity =
    options.cargoCapacity ?? INVENTORY_CONFIG.cargoCapacity;

  simulation.queueControls({ brake: 1, interact: true }, 1);
  return simulation;
}

function cargoOf(simulation: Simulation, kind: ResourceKind): number {
  return simulation.world.economy.cargo[kind];
}

function starterBase(simulation: Simulation) {
  const base = simulation.world.bases[0];
  if (!base) throw new Error('expected a starter base');
  return base;
}

function storageOf(simulation: Simulation, kind: ResourceKind): number {
  return starterBase(simulation).storage[kind];
}

/** Moves the starter base to the car so deposits are in range. */
function parkOnBase(simulation: Simulation): void {
  const base = starterBase(simulation);
  simulation.world.bases[0] = {
    ...base,
    x: simulation.world.vehicle.position.x,
    y: simulation.world.vehicle.position.y,
  };
}

/** Moves the starter base far away so only nodes are in reach. */
function moveBaseAway(simulation: Simulation): void {
  const base = starterBase(simulation);
  simulation.world.bases[0] = { ...base, x: 150, y: 150 };
}

function totalOf(simulation: Simulation): number {
  const { cargo } = simulation.world.economy;
  const storage = starterBase(simulation).storage;
  const nodeTotal = simulation.world.resourceNodes.reduce(
    (sum, node) => sum + node.remaining,
    0,
  );
  const amounts = RESOURCE_KINDS.reduce(
    (sum, kind) => sum + cargo[kind] + storage[kind],
    0,
  );
  return amounts + nodeTotal;
}

describe('resource config', () => {
  it('ships valid definitions and inventory config', () => {
    expect(validateResourceDefinitions(RESOURCE_DEFINITIONS)).toEqual([]);
    expect(validateInventoryConfig(INVENTORY_CONFIG)).toEqual([]);
  });

  it('rejects invalid inventory numbers', () => {
    expect(
      validateInventoryConfig({
        ...INVENTORY_CONFIG,
        cargoCapacity: 0,
        harvestRateUnitsPerSecond: 0,
        depositReach: -1,
      }),
    ).toEqual([
      'cargoCapacity must be a positive integer',
      'harvestRateUnitsPerSecond must be a finite positive number',
      'depositReach must be a finite non-negative number',
    ]);
  });

  it('rejects invalid resource definitions', () => {
    const errors = validateResourceDefinitions({
      scrap: { ...RESOURCE_DEFINITIONS.scrap, displayName: ' ', nodeAmount: 0 },
    });
    expect(errors).toEqual([
      'scrap.displayName must be a non-empty string',
      'scrap.nodeAmount must be a positive integer',
    ]);
  });
});

describe('harvesting', () => {
  it('reports a harvest target when a node is in reach', () => {
    const simulation = createHarvestSim();
    simulation.step();

    expect(simulation.world.interaction?.kind).toBe('harvest');
    expect(simulation.world.interaction?.nodeId).toBe('test-node');
    expect(simulation.world.interaction?.resource).toBe('scrap');
  });

  it('fills the trunk and empties the node without losing units', () => {
    const simulation = createHarvestSim({ amount: 10 });
    const before = totalOf(simulation);

    for (let tick = 0; tick < 300; tick += 1) simulation.step();

    expect(cargoOf(simulation, 'scrap')).toBe(10);
    expect(simulation.world.resourceNodes[0]?.remaining).toBe(0);
    expect(totalOf(simulation)).toBe(before);
  });

  it('stops at cargo capacity and leaves the rest in the node', () => {
    const simulation = createHarvestSim({ amount: 40, cargoCapacity: 12 });
    for (let tick = 0; tick < 300; tick += 1) simulation.step();

    expect(cargoOf(simulation, 'scrap')).toBe(12);
    expect(simulation.world.resourceNodes[0]?.remaining).toBe(28);
    // Nothing is destroyed when the trunk fills up.
    expect(totalOf(simulation)).toBe(40);
  });

  it('does not harvest without holding interact', () => {
    const simulation = createHarvestSim({ amount: 10 });
    simulation.queueControls({ brake: 1, interact: false }, 2);

    for (let tick = 0; tick < 120; tick += 1) simulation.step();

    expect(cargoOf(simulation, 'scrap')).toBe(0);
    expect(simulation.world.resourceNodes[0]?.remaining).toBe(10);
  });

  it('does not harvest out of reach', () => {
    const simulation = createHarvestSim({ amount: 10 });
    const node = simulation.world.resourceNodes[0]!;
    simulation.world.resourceNodes = [{ ...node, x: 60 }];

    for (let tick = 0; tick < 120; tick += 1) simulation.step();

    expect(cargoOf(simulation, 'scrap')).toBe(0);
    expect(simulation.world.interaction).toBeNull();
  });

  it('harvests slower with higher difficulty', () => {
    const run = (kind: ResourceKind): number => {
      const simulation = createHarvestSim({ kind, amount: 60 });
      for (let tick = 0; tick < 60; tick += 1) simulation.step();
      return cargoOf(simulation, kind);
    };

    // Scrap is difficulty 1, fuel 0.55, so one second yields less fuel.
    expect(run('scrap')).toBeGreaterThan(run('fuel'));
  });

  it('records depletion so a mined node stays mined', () => {
    const simulation = createHarvestSim({ amount: 10 });
    for (let tick = 0; tick < 300; tick += 1) simulation.step();

    expect(simulation.world.economy.depletion['test-node']).toBe(0);
  });
});

describe('unloading', () => {
  it('moves cargo into storage near the depot', () => {
    const simulation = createHarvestSim({ amount: 10 });
    for (let tick = 0; tick < 300; tick += 1) simulation.step();
    expect(cargoOf(simulation, 'scrap')).toBe(10);

    // Park on the depot and keep holding interact.
    parkOnBase(simulation);
    for (let tick = 0; tick < 120; tick += 1) simulation.step();

    expect(cargoOf(simulation, 'scrap')).toBe(0);
    expect(storageOf(simulation, 'scrap')).toBe(10);
    expect(simulation.world.interaction).toBeNull();
  });

  it('prompts for unloading when carrying cargo on the depot', () => {
    const simulation = createHarvestSim({ amount: 5 });
    simulation.world.economy.cargo.scrap = 5;
    parkOnBase(simulation);
    simulation.step();

    expect(simulation.world.interaction?.kind).toBe('deposit');
    expect(simulation.world.interaction?.label).toBe('РАЗГРУЗИТЬ');
  });

  it('does not unload when the trunk is empty', () => {
    const simulation = createHarvestSim({ amount: 5 });
    // Move the node away so only the depot is in play.
    const node = simulation.world.resourceNodes[0]!;
    simulation.world.resourceNodes = [{ ...node, x: 60 }];
    parkOnBase(simulation);
    simulation.step();

    expect(simulation.world.interaction).toBeNull();
    expect(simulation.snapshot().economy.storageTotal).toBe(0);
  });
});

describe('economy determinism and transport', () => {
  it('is deterministic for the same command sequence', () => {
    const run = (): string => {
      const simulation = createHarvestSim({ amount: 25 });
      for (let tick = 0; tick < 240; tick += 1) simulation.step();
      parkOnBase(simulation);
      for (let tick = 0; tick < 240; tick += 1) simulation.step();
      return JSON.stringify(simulation.snapshot().economy);
    };

    expect(run()).toBe(run());
  });

  it('exposes cargo, storage and nodes in the snapshot', () => {
    const simulation = createHarvestSim({ amount: 7 });
    for (let tick = 0; tick < 300; tick += 1) simulation.step();

    const economy = simulation.snapshot().economy;
    expect(economy.cargo.scrap).toBe(7);
    expect(economy.cargoTotal).toBe(7);
    expect(economy.cargoCapacity).toBe(INVENTORY_CONFIG.cargoCapacity);
    expect(economy.resourceNodes).toHaveLength(1);
    expect(economy.resourceNodes[0]?.remaining).toBe(0);
  });
});
