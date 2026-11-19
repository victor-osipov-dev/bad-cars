import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_MODULES,
  EQUIPMENT_MODULE_IDS,
  EQUIPMENT_SLOTS,
  GARAGE_CONFIG,
  MAX_UPGRADE_LEVEL,
  UPGRADE_TRACKS,
  UPGRADE_TRACK_KINDS,
  validateEquipmentModule,
  validateEquipmentSlots,
  validateGarageConfig,
  validateUpgradeTracks,
} from '../src/data/garage';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { INVENTORY_CONFIG } from '../src/data/resources';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { CANNON, FLAK_GUN, MACHINE_GUN } from '../src/data/weapons';
import { createStructure } from '../src/sim/base/BaseState';
import {
  createGarageState,
  describeUpgrade,
  findSlot,
  installModule,
  loadoutMatches,
  removeModule,
  resolveLoadout,
  resolveVehicleStats,
  storeCombatAmmo,
  upgradeLevel,
  type GarageContext,
  type GarageState,
} from '../src/sim/garage/GarageState';
import { EquipmentCommandQueue } from '../src/sim/input/EquipmentCommandQueue';
import {
  garageActionFromKey,
  GARAGE_KEYS,
  WEAPON_SLOT_KEYS,
} from '../src/app/GarageInput';
import { Simulation } from '../src/sim/Simulation';
import { Vec2 } from '../src/core/math/Vec2';
import type { ResourceAmounts } from '../src/sim/economy/EconomyState';

function createConfig(overrides: Partial<GameplayConfig> = {}): GameplayConfig {
  return {
    ...GAME_CONFIG,
    world: { ...GAME_CONFIG.world, halfWidth: 120, halfHeight: 120 },
    vehicle: { ...SCRAP_RUNNER, spawn: { x: 0, y: 0, headingRadians: 0 } },
    enemySpawns: [],
    ...overrides,
  };
}

function richCargo(): ResourceAmounts {
  return { scrap: 1000, fuel: 1000, water: 1000 };
}

function context(overrides: Partial<GarageContext> = {}): GarageContext {
  return {
    atBase: true,
    hasWorkshop: true,
    cargo: richCargo(),
    ...overrides,
  };
}

function freshGarage(): GarageState {
  return createGarageState(SCRAP_RUNNER, [
    { weaponId: MACHINE_GUN.id, reserveAmmo: 192 },
    { weaponId: CANNON.id, reserveAmmo: 24 },
  ]);
}

/** Puts the car on the starter pad and gives the base a workshop. */
function simAtGarage(config: GameplayConfig = createConfig()): Simulation {
  const simulation = new Simulation(config);
  const base = simulation.world.bases[0];
  if (!base) throw new Error('expected a starter base');

  simulation.world.vehicle = {
    ...simulation.world.vehicle,
    position: new Vec2(base.x, base.y),
    velocity: Vec2.ZERO,
  };
  base.structures.push(
    createStructure({
      id: 'struct-workshop',
      kind: 'workshop',
      x: base.x + 1,
      y: base.y,
      slotIndex: 0,
      builtTick: 0,
      maxCondition: 3,
    }),
  );
  simulation.world.economy.cargo.scrap = 500;
  simulation.world.economy.cargo.fuel = 500;
  simulation.world.economy.cargo.water = 500;
  return simulation;
}

describe('garage data', () => {
  it('ships valid slots, modules, tracks and config', () => {
    expect(validateEquipmentSlots(EQUIPMENT_SLOTS)).toEqual([]);
    expect(validateUpgradeTracks(UPGRADE_TRACKS)).toEqual([]);
    expect(validateGarageConfig(GARAGE_CONFIG)).toEqual([]);
    for (const module of Object.values(EQUIPMENT_MODULES)) {
      expect(validateEquipmentModule(module)).toEqual([]);
    }
  });

  it('has two weapon hardpoints before the utility bays', () => {
    const kinds = EQUIPMENT_SLOTS.map((slot) => slot.kind);
    expect(kinds).toEqual(['weapon', 'weapon', 'utility', 'utility']);
    expect(EQUIPMENT_SLOTS.filter((slot) => slot.kind === 'weapon')).toHaveLength(2);
  });

  it('rejects duplicate slots and missing weapon hardpoints', () => {
    expect(
      validateEquipmentSlots([
        { id: 'a', kind: 'utility', displayName: 'A', order: 0 },
        { id: 'a', kind: 'utility', displayName: 'B', order: 1 },
      ]),
    ).toEqual([
      'duplicate slot id "a"',
      'at least one weapon slot is required',
    ]);
    expect(validateEquipmentSlots([])).toEqual([
      'at least one equipment slot is required',
      'at least one weapon slot is required',
    ]);
  });

  it('rejects a weapon module with no weapon and a utility with no modifiers', () => {
    const weaponErrors = validateEquipmentModule({
      id: 'broken-gun',
      displayName: 'Broken',
      shortName: 'BR',
      color: '#fff',
      slotKind: 'weapon',
      cost: { scrap: 10 },
      requiredWorkshopLevel: 0,
    });
    expect(weaponErrors).toContain('broken-gun: weapon modules must name a weapon');
    expect(weaponErrors).toContain('broken-gun.reserveAmmo must be a non-negative integer');

    const utilityErrors = validateEquipmentModule({
      id: 'broken-plate',
      displayName: 'Broken',
      shortName: 'BR',
      color: '#fff',
      slotKind: 'utility',
      cost: { scrap: 10 },
      requiredWorkshopLevel: 0,
    });
    expect(utilityErrors).toContain('broken-plate: utility modules must declare modifiers');
  });

  it('rejects out-of-order upgrade levels', () => {
    const errors = validateUpgradeTracks({
      ...UPGRADE_TRACKS,
      engine: [UPGRADE_TRACKS.engine[1]!, UPGRADE_TRACKS.engine[0]!],
    });
    expect(errors).toContain('track engine level 1 is out of order');
    expect(errors).toContain('track engine level 2 is out of order');
  });

  it('exposes every weapon in the catalogue as a module', () => {
    for (const id of [MACHINE_GUN.id, CANNON.id, FLAK_GUN.id]) {
      expect(EQUIPMENT_MODULE_IDS).toContain(id);
      expect(EQUIPMENT_MODULES[id]?.weaponId).toBe(id);
    }
    // One module id per weapon, so the catalogue cannot silently drift.
    const weaponModules = Object.values(EQUIPMENT_MODULES).filter(
      (module) => module.slotKind === 'weapon',
    );
    expect(weaponModules).toHaveLength(3);
  });
});

describe('garage slots', () => {
  it('starts with the starter loadout fitted into the weapon hardpoints', () => {
    const garage = freshGarage();
    expect(garage.slots.map((slot) => slot.moduleId)).toEqual([
      MACHINE_GUN.id,
      CANNON.id,
      null,
      null,
    ]);
    expect(resolveLoadout(garage)).toEqual([
      { weaponId: MACHINE_GUN.id, reserveAmmo: 192 },
      { weaponId: CANNON.id, reserveAmmo: 24 },
    ]);
    expect(garage.selectedSlot).toBe(0);
    expect(garage.levels).toEqual({ engine: 0, chassis: 0, workshop: 0 });
  });

  it('refuses a module in the wrong slot kind', () => {
    const garage = freshGarage();
    const result = installModule(
      garage,
      context(),
      'utility-1',
      MACHINE_GUN.id,
    );
    expect(result).toEqual({ ok: false, reason: 'wrong-slot-kind' });
  });

  it('refuses installs away from a workshop and with bad funds', () => {
    const garage = freshGarage();
    expect(
      installModule(garage, context({ atBase: false }), 'utility-1', 'reinforced-plating'),
    ).toEqual({ ok: false, reason: 'no-base' });
    expect(
      installModule(garage, context({ hasWorkshop: false }), 'utility-1', 'reinforced-plating'),
    ).toEqual({ ok: false, reason: 'no-workshop' });
    expect(
      installModule(
        garage,
        context({ cargo: { scrap: 0, fuel: 0, water: 0 } }),
        'utility-1',
        'reinforced-plating',
      ),
    ).toEqual({ ok: false, reason: 'not-enough-resources' });
  });

  it('refuses to overwrite an occupied bay', () => {
    const garage = freshGarage();
    // Machine gun is the only weapon module with no workshop requirement, so
    // the occupied-bay refusal is not masked by a level check.
    expect(installModule(garage, context(), 'weapon-1', MACHINE_GUN.id)).toEqual({
      ok: false,
      reason: 'slot-occupied',
    });
  });

  it('charges the module cost from cargo and returns it on removal', () => {
    const garage = freshGarage();
    const cargo = richCargo();
    const ctx = context({ cargo });
    const cost = EQUIPMENT_MODULES['reinforced-plating']?.cost.scrap ?? 0;

    expect(installModule(garage, ctx, 'utility-1', 'reinforced-plating').ok).toBe(true);
    expect(cargo.scrap).toBe(1000 - cost);
    expect(findSlot(garage, 'utility-1')?.moduleId).toBe('reinforced-plating');

    expect(removeModule(garage, ctx, 'utility-1').ok).toBe(true);
    expect(findSlot(garage, 'utility-1')?.moduleId).toBeNull();
    expect(garage.locker).toEqual([
      { moduleId: 'reinforced-plating', ammoInMagazine: 0, reserveAmmo: 0 },
    ]);
    // Removal does not refund: the module is kept, the money is not.
    expect(cargo.scrap).toBe(1000 - cost);
  });

  it('requires the workshop level a module declares', () => {
    const garage = freshGarage();
    expect(installModule(garage, context(), 'utility-1', 'cargo-expander')).toEqual({
      ok: false,
      reason: 'workshop-level',
    });
    expect(upgradeLevel(garage, context(), 'workshop').ok).toBe(true);
    expect(installModule(garage, context(), 'utility-1', 'cargo-expander').ok).toBe(true);
  });

  it('keeps ammunition with the module across a swap', () => {
    const garage = freshGarage();
    const cargo = richCargo();
    const ctx = context({ cargo });

    // The gun has been partly fired before it is pulled out.
    storeCombatAmmo(garage, [
      { weaponId: MACHINE_GUN.id, ammoInMagazine: 7, reserveAmmo: 100 },
      { weaponId: CANNON.id, ammoInMagazine: 6, reserveAmmo: 24 },
    ]);
    expect(removeModule(garage, ctx, 'weapon-1').ok).toBe(true);
    expect(garage.locker[0]).toEqual({
      moduleId: MACHINE_GUN.id,
      ammoInMagazine: 7,
      reserveAmmo: 100,
    });

    expect(installModule(garage, ctx, 'weapon-1', MACHINE_GUN.id).ok).toBe(true);
    expect(findSlot(garage, 'weapon-1')).toMatchObject({
      moduleId: MACHINE_GUN.id,
      ammoInMagazine: 7,
      reserveAmmo: 100,
    });
    void cargo;
  });

  it('reports a failed install of an unknown module or slot', () => {
    const garage = freshGarage();
    expect(installModule(garage, context(), 'engine-bay', MACHINE_GUN.id)).toEqual({
      ok: false,
      reason: 'unknown-slot',
    });
    expect(installModule(garage, context(), 'weapon-1', 'death-ray')).toEqual({
      ok: false,
      reason: 'unknown-module',
    });
    expect(removeModule(garage, context(), 'utility-1')).toEqual({
      ok: false,
      reason: 'slot-empty',
    });
  });
});

describe('vehicle stat resolution', () => {
  it('reports the base stats for a stock garage', () => {
    const stats = resolveVehicleStats(SCRAP_RUNNER, freshGarage());
    expect(stats.armor).toBe(0);
    expect(stats.cargoCapacity).toBe(INVENTORY_CONFIG.cargoCapacity);
    expect(stats.harvestBonus).toBe(0);
    expect(stats.radarBonus).toBe(0);
    expect(stats.maxHealth).toBe(SCRAP_RUNNER.durability.maxHealth);
    expect(stats.maxForwardSpeed).toBe(SCRAP_RUNNER.physics.maxForwardSpeed);
  });

  it('adds utility modifiers and engine upgrades to the stats', () => {
    const garage = freshGarage();
    const cargo = richCargo();
    const ctx = context({ cargo });

    expect(installModule(garage, ctx, 'utility-1', 'reinforced-plating').ok).toBe(true);
    expect(upgradeLevel(garage, ctx, 'engine').ok).toBe(true);
    expect(upgradeLevel(garage, ctx, 'chassis').ok).toBe(true);

    const stats = resolveVehicleStats(SCRAP_RUNNER, garage);
    const engine = UPGRADE_TRACKS.engine[0];
    const chassis = UPGRADE_TRACKS.chassis[0];
    expect(stats.armor).toBe(45 + (chassis?.modifiers.armor ?? 0));
    expect(stats.maxHealth).toBe(SCRAP_RUNNER.durability.maxHealth + stats.armor);
    expect(stats.maxForwardSpeed).toBe(
      SCRAP_RUNNER.physics.maxForwardSpeed + (engine?.modifiers.maxForwardSpeed ?? 0),
    );
  });

  it('is exactly reversible: install then remove restores every stat', () => {
    const garage = freshGarage();
    const ctx = context();
    const before = resolveVehicleStats(SCRAP_RUNNER, garage);

    expect(installModule(garage, ctx, 'utility-1', 'salvage-rig').ok).toBe(false);
    expect(upgradeLevel(garage, ctx, 'workshop').ok).toBe(true);
    expect(installModule(garage, ctx, 'utility-1', 'salvage-rig').ok).toBe(true);
    expect(resolveVehicleStats(SCRAP_RUNNER, garage).harvestBonus).toBeGreaterThan(0);

    expect(removeModule(garage, ctx, 'utility-1').ok).toBe(true);
    expect(resolveVehicleStats(SCRAP_RUNNER, garage)).toEqual(before);
  });

  it('caps stacked modifiers at the configured ceilings', () => {
    const garage = freshGarage();
    const ctx = context();
    for (const track of UPGRADE_TRACK_KINDS) {
      for (let level = 0; level < MAX_UPGRADE_LEVEL; level += 1) {
        upgradeLevel(garage, ctx, track);
      }
    }
    // Chassis level 3 stacks cargo twice (levels 2 and 3), plus the expander.
    expect(installModule(garage, ctx, 'utility-1', 'cargo-expander').ok).toBe(true);
    expect(installModule(garage, ctx, 'utility-2', 'cargo-expander').ok).toBe(true);

    const stats = resolveVehicleStats(SCRAP_RUNNER, garage);
    expect(stats.cargoCapacity).toBeLessThanOrEqual(GARAGE_CONFIG.maxCargoCapacity);
    expect(stats.armor).toBeLessThanOrEqual(GARAGE_CONFIG.maxArmor);
    expect(stats.harvestBonus).toBeLessThanOrEqual(GARAGE_CONFIG.maxHarvestBonus);
  });
});

describe('upgrade tracks', () => {
  it('walks each track to its maximum and then refuses', () => {
    const garage = freshGarage();
    const cargo = richCargo();
    const ctx = context({ cargo });

    for (const track of UPGRADE_TRACK_KINDS) {
      for (let level = 1; level <= UPGRADE_TRACKS[track].length; level += 1) {
        expect(upgradeLevel(garage, ctx, track).ok).toBe(true);
        expect(garage.levels[track]).toBe(level);
      }
      expect(describeUpgrade(garage, ctx, track).reason).toBe('max-level');
      expect(upgradeLevel(garage, ctx, track)).toEqual({ ok: false, reason: 'max-level' });
    }
  });

  it('reports the next level and its cost for the HUD', () => {
    const garage = freshGarage();
    const verdict = describeUpgrade(garage, context(), 'engine');
    expect(verdict.ok).toBe(true);
    expect(verdict.nextLevel).toBe(1);
    expect(verdict.label).toBe(UPGRADE_TRACKS.engine[0]?.displayName);
    expect(verdict.cost).toEqual(UPGRADE_TRACKS.engine[0]?.cost);
  });

  it('refuses upgrades without a workshop or funds', () => {
    const garage = freshGarage();
    expect(upgradeLevel(garage, context({ hasWorkshop: false }), 'engine')).toEqual({
      ok: false,
      reason: 'no-workshop',
    });
    expect(
      upgradeLevel(
        garage,
        context({ cargo: { scrap: 0, fuel: 0, water: 0 } }),
        'engine',
      ),
    ).toEqual({ ok: false, reason: 'not-enough-resources' });
    expect(garage.levels.engine).toBe(0);
  });
});

describe('equipment command queue', () => {
  it('applies actions on their tick, in order', () => {
    const queue = new EquipmentCommandQueue();
    queue.enqueue({ tick: 5, action: { kind: 'upgrade', track: 'engine' } });
    queue.enqueue({ tick: 2, action: { kind: 'select-slot', index: 1 } });

    expect(queue.drain(1)).toEqual([]);
    expect(queue.drain(2)).toEqual([{ kind: 'select-slot', index: 1 }]);
    expect(queue.drain(5)).toEqual([{ kind: 'upgrade', track: 'engine' }]);
    expect(queue.pendingCount).toBe(0);
  });

  it('drains several actions due at once instead of keeping only the last', () => {
    const queue = new EquipmentCommandQueue();
    queue.enqueue({ tick: 3, action: { kind: 'upgrade', track: 'engine' } });
    queue.enqueue({ tick: 3, action: { kind: 'upgrade', track: 'chassis' } });
    expect(queue.drain(3)).toHaveLength(2);
  });

  it('rejects malformed actions and bad ticks', () => {
    const queue = new EquipmentCommandQueue();
    queue.enqueue({ tick: 1, action: { kind: 'nope' } as never });
    expect(queue.pendingCount).toBe(0);
    expect(() => queue.enqueue({ tick: -1, action: { kind: 'remove' } })).toThrow(RangeError);
  });
});

describe('garage keyboard mapping', () => {
  const base = { repeat: false, ctrlKey: false, metaKey: false, altKey: false };

  it('maps digits to slots and letters to actions', () => {
    expect(garageActionFromKey({ ...base, code: 'Digit1' })).toEqual({
      kind: 'select-slot',
      index: 0,
    });
    expect(garageActionFromKey({ ...base, code: 'Digit3' })).toEqual({
      kind: 'select-slot',
      index: 2,
    });
    expect(garageActionFromKey({ ...base, code: 'KeyG' })).toEqual({ kind: 'install' });
    expect(garageActionFromKey({ ...base, code: 'KeyH' })).toEqual({ kind: 'remove' });
    expect(garageActionFromKey({ ...base, code: 'KeyN' })).toEqual({
      kind: 'upgrade',
      track: 'engine',
    });
    expect(garageActionFromKey({ ...base, code: 'KeyM' })).toEqual({
      kind: 'upgrade',
      track: 'chassis',
    });
    expect(garageActionFromKey({ ...base, code: 'Comma' })).toEqual({
      kind: 'upgrade',
      track: 'workshop',
    });
  });

  it('ignores repeats, modifiers and unrelated keys', () => {
    expect(garageActionFromKey({ ...base, code: 'KeyG', repeat: true })).toBeNull();
    expect(garageActionFromKey({ ...base, code: 'KeyG', ctrlKey: true })).toBeNull();
    expect(garageActionFromKey({ ...base, code: 'Space' })).toBeNull();
    expect(GARAGE_KEYS.has('Space')).toBe(false);
  });

  it('exposes weapon slot keys for the combat input', () => {
    expect(WEAPON_SLOT_KEYS.get('Digit1')).toBe(0);
    expect(WEAPON_SLOT_KEYS.get('Digit2')).toBe(1);
  });
});

describe('garage in the simulation', () => {
  it('reports no garage away from a base and opens it on a workshop base', () => {
    const simulation = new Simulation(createConfig());
    simulation.step();
    expect(simulation.snapshot().garage.info?.open).toBe(false);
    expect(simulation.snapshot().garage.info?.atBase).toBe(false);

    const parked = simAtGarage();
    parked.step();
    expect(parked.snapshot().garage.info?.open).toBe(true);
    expect(parked.snapshot().garage.info?.panelLabel).toContain('ГАРАЖ');
  });

  it('installs a utility module through the command queue', () => {
    const simulation = simAtGarage();
    simulation.step();

    simulation.queueEquipmentAction({ kind: 'select-slot', index: 2 });
    simulation.queueEquipmentAction({ kind: 'install', moduleId: 'reinforced-plating' });
    simulation.step();
    simulation.step();

    expect(
      simulation.world.garage.slots[2]?.moduleId,
    ).toBe('reinforced-plating');
    const stats = simulation.snapshot().garage.stats;
    expect(stats.armor).toBe(45);
    expect(simulation.world.vehicleMaxHealth).toBe(
      SCRAP_RUNNER.durability.maxHealth + 45,
    );
    expect(simulation.snapshot().vehicle.maxHealth).toBe(
      SCRAP_RUNNER.durability.maxHealth + 45,
    );
  });

  it('raises current hit points when armour is fitted', () => {
    const simulation = simAtGarage();
    simulation.world.vehicleHealth = 50;
    simulation.step();

    simulation.queueEquipmentAction({ kind: 'select-slot', index: 2 });
    simulation.queueEquipmentAction({ kind: 'install', moduleId: 'reinforced-plating' });
    simulation.step();
    simulation.step();

    expect(simulation.world.vehicleHealth).toBe(95);
  });

  it('rebuilds the weapon list when a hardpoint module changes', () => {
    const simulation = simAtGarage();
    simulation.step();
    expect(simulation.world.combat.weapons.map((slot) => slot.weaponId)).toEqual([
      MACHINE_GUN.id,
      CANNON.id,
    ]);

    simulation.queueEquipmentAction({ kind: 'select-slot', index: 1 });
    simulation.queueEquipmentAction({ kind: 'remove' });
    simulation.step();
    simulation.step();

    expect(simulation.world.combat.weapons.map((slot) => slot.weaponId)).toEqual([
      MACHINE_GUN.id,
    ]);
    expect(loadoutMatches(simulation.world.garage, simulation.world.combat.weapons)).toBe(
      true,
    );
  });

  it('applies engine upgrades to the driving model on the next tick', () => {
    const simulation = simAtGarage();
    simulation.queueEquipmentAction({ kind: 'upgrade', track: 'engine' });
    simulation.step();
    simulation.step();

    expect(simulation.world.garage.levels.engine).toBe(1);
    expect(simulation.snapshot().garage.stats.maxForwardSpeed).toBeGreaterThan(
      SCRAP_RUNNER.physics.maxForwardSpeed,
    );
  });

  it('applies cargo upgrades to the trunk capacity', () => {
    const simulation = simAtGarage();
    const before = simulation.world.economy.cargoCapacity;

    simulation.queueEquipmentAction({ kind: 'upgrade', track: 'workshop' });
    simulation.step();
    simulation.step();
    simulation.queueEquipmentAction({ kind: 'select-slot', index: 2 });
    simulation.queueEquipmentAction({ kind: 'install', moduleId: 'cargo-expander' });
    simulation.step();
    simulation.step();

    expect(simulation.snapshot().garage.stats.cargoCapacity).toBe(before + 60);
    // The economy trunk and the garage report must agree.
    expect(simulation.world.economy.cargoCapacity).toBe(before + 60);
  });

  it('dumps cargo that no longer fits after a trunk is removed', () => {
    const simulation = simAtGarage();
    simulation.queueEquipmentAction({ kind: 'upgrade', track: 'workshop' });
    simulation.step();
    simulation.step();
    simulation.queueEquipmentAction({ kind: 'select-slot', index: 2 });
    simulation.queueEquipmentAction({ kind: 'install', moduleId: 'cargo-expander' });
    simulation.step();
    simulation.step();
    expect(simulation.world.economy.cargoCapacity).toBe(180);

    // Fill the hold, then pull the expander: the overflow must be dumped.
    simulation.world.economy.cargo.scrap = 180;
    simulation.queueEquipmentAction({ kind: 'select-slot', index: 2 });
    simulation.queueEquipmentAction({ kind: 'remove' });
    simulation.step();
    simulation.step();

    expect(simulation.world.economy.cargoCapacity).toBe(120);
    expect(
      simulation.world.economy.cargo.scrap +
        simulation.world.economy.cargo.fuel +
        simulation.world.economy.cargo.water,
    ).toBe(120);
  });

  it('is deterministic: the same command stream yields the same garage', () => {
    const run = (): string => {
      const simulation = simAtGarage();
      simulation.step();
      simulation.queueEquipmentAction({ kind: 'upgrade', track: 'workshop' });
      simulation.queueEquipmentAction({ kind: 'upgrade', track: 'engine' });
      simulation.queueEquipmentAction({ kind: 'select-slot', index: 3 });
      simulation.queueEquipmentAction({ kind: 'install', moduleId: 'salvage-rig' });
      for (let tick = 0; tick < 30; tick += 1) simulation.step();
      return JSON.stringify(simulation.snapshot().garage);
    };

    expect(run()).toBe(run());
  });

  it('counts a workshop built on the same tick as available', () => {
    const simulation = new Simulation(createConfig());
    const base = simulation.world.bases[0];
    if (!base) throw new Error('expected base');
    simulation.world.vehicle = {
      ...simulation.world.vehicle,
      position: new Vec2(base.x, base.y),
      velocity: Vec2.ZERO,
    };
    simulation.world.economy.cargo.scrap = 200;
    simulation.world.economy.cargo.water = 50;

    // V builds the next structure (depot first), then the workshop later; the
    // garage must not open until the workshop exists.
    simulation.queueControls({ brake: 1, buildToken: 1 }, 1);
    simulation.step();
    expect(simulation.snapshot().garage.info?.hasWorkshop).toBe(false);

    base.structures.push(
      createStructure({
        id: 'struct-workshop',
        kind: 'workshop',
        x: base.x,
        y: base.y,
        slotIndex: 1,
        builtTick: simulation.time.tick,
        maxCondition: 3,
      }),
    );
    simulation.step();
    expect(simulation.snapshot().garage.info?.hasWorkshop).toBe(true);
  });
});
