import { describe, expect, it } from 'vitest';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { Simulation } from '../src/sim/Simulation';
import { Vec2 } from '../src/core/math/Vec2';
import { resolveVehicleStats } from '../src/sim/garage/GarageState';
import { SAVE_SCHEMA_VERSION } from '../src/sim/persistence/SerializedGameState';
import { MemorySaveStore } from '../src/save/MemorySaveStore';
import { AutoSaveController } from '../src/save/AutoSaveController';
import { migrateSaveFile, SaveMigrationError } from '../src/save/migrations';
import { validateSaveFile } from '../src/save/validateSave';

function createConfig(): GameplayConfig {
  return {
    ...GAME_CONFIG,
    world: { ...GAME_CONFIG.world, halfWidth: 120, halfHeight: 120 },
    vehicle: { ...SCRAP_RUNNER, spawn: { x: 0, y: 0, headingRadians: 0 } },
    enemySpawns: [],
  };
}

function makeSim(): Simulation {
  const simulation = new Simulation(createConfig());
  simulation.stepMany(12);
  return simulation;
}

function signals(tick: number, overrides: Partial<{
  baseCount: number;
  structureCount: number;
  capturedCount: number;
  garageRevision: number;
}> = {}) {
  return {
    tick,
    baseCount: overrides.baseCount ?? 1,
    structureCount: overrides.structureCount ?? 0,
    capturedCount: overrides.capturedCount ?? 0,
    garageRevision: overrides.garageRevision ?? 0,
  };
}

describe('save validation', () => {
  it('accepts a freshly exported state', () => {
    const state = makeSim().exportState();
    const file = { schemaVersion: SAVE_SCHEMA_VERSION, savedAt: 1234, game: state };
    expect(validateSaveFile(file)).toEqual([]);
  });

  it('rejects a malformed envelope and a malformed game state', () => {
    expect(validateSaveFile(null).length).toBeGreaterThan(0);
    expect(validateSaveFile({ schemaVersion: 2, savedAt: 0, game: {} }).length).toBeGreaterThan(0);
    expect(
      validateSaveFile({
        schemaVersion: 2,
        savedAt: 0,
        game: { ...makeSim().exportState(), tick: -1 },
      }),
    ).toContain('game.tick must be >= 0');
  });
});

describe('migrations', () => {
  it('keeps a current save unchanged', () => {
    const file = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: 555,
      game: makeSim().exportState(),
    };
    expect(migrateSaveFile(structuredClone(file))).toEqual(file);
  });

  it('migrates a v1 save by filling the v2 fields with defaults', () => {
    const current = makeSim().exportState();
    const legacy = {
      schemaVersion: 1,
      savedAt: 777,
      game: {
        config: current.config,
        tick: current.tick,
        vehicle: {
          x: current.vehicle.x,
          y: current.vehicle.y,
          heading: current.vehicle.heading,
          health: current.vehicle.health,
          destroyed: false,
        },
        garage: {
          slots: current.garage.slots.map((slot) => ({
            slotId: slot.slotId,
            moduleId: slot.moduleId,
          })),
          levels: current.garage.levels,
        },
        economy: { cargo: current.economy.cargo },
        bases: current.bases.items,
      },
    };

    const migrated = migrateSaveFile(legacy);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.savedAt).toBe(777);
    expect(migrated.game.rngState).toBe(current.config.worldSeed);
    expect(migrated.game.garage.locker).toEqual([]);
    expect(migrated.game.economy.depletion).toEqual({});
    expect(migrated.game.enemies).toEqual([]);
    expect(migrated.game.remote.ticks).toBe(0);
    expect(migrated.game.vehicle.respawnRemainingSeconds).toBe(0);
    expect(migrated.game.garage.slots[0]?.ammoInMagazine).toBeGreaterThan(0);
    expect(validateSaveFile(migrated)).toEqual([]);
  });

  it('migrates a v2 save with live raiders and missing control fields', () => {
    const current = makeSim().exportState();
    const legacy = { schemaVersion: 2, savedAt: 999, game: structuredClone(current) } as unknown as {
      schemaVersion: number;
      savedAt: number;
      game: Record<string, any>;
    };
    delete legacy.game.controls;
    delete legacy.game.aim;
    delete legacy.game.nextIds;
    legacy.game.enemies = [{
      id: 'raider-legacy',
      kind: 'raider',
      aiState: 'attack',
      stateSeconds: 0,
      bestDistance: 0,
      stallSeconds: 0,
      patrolAngle: 0,
      aimAngle: 0,
      rotation: 0,
      x: 12,
      y: -4,
      health: 45,
      alive: true,
      respawnRemainingSeconds: 0,
      fireCooldownSeconds: 0,
    }];

    const migrated = migrateSaveFile(legacy);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.game.controls.steer).toBe(0);
    expect(migrated.game.aim.fire).toBe(false);
    expect(migrated.game.nextIds.enemy).toBe(1);
    const enemy = migrated.game.enemies[0]!;
    expect(enemy.spawnX).toBe(enemy.x);
    expect(enemy.spawnY).toBe(enemy.y);
    expect(enemy.radius).toBeGreaterThan(0);
    expect(enemy.maxHealth).toBeGreaterThan(0);
    expect(validateSaveFile(migrated)).toEqual([]);
  });

  it('rejects a save from a newer version', () => {
    expect(() =>
      migrateSaveFile({ schemaVersion: SAVE_SCHEMA_VERSION + 1, savedAt: 0, game: {} }),
    ).toThrowError(expect.objectContaining({ code: 'newer-version' }));
  });

  it('rejects a non-save payload', () => {
    expect(() => migrateSaveFile('not json')).toThrowError(
      expect.objectContaining({ code: 'not-a-save' }),
    );
  });
});

describe('MemorySaveStore', () => {
  it('round-trips a save and reports slot captions', async () => {
    const store = new MemorySaveStore();
    const file = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: Date.UTC(2026, 9, 24, 12, 30),
      game: makeSim().exportState(),
    };

    expect(await store.load(1)).toBeNull();
    await store.save(2, file);
    expect(await store.load(2)).toEqual(file);

    const slots = await store.list();
    expect(slots).toHaveLength(3);
    expect(slots[0]?.label).toBe('ПУСТО');
    expect(slots[1]?.label).toContain('тик');
    expect(slots[1]?.tick).toBe(file.game.tick);

    await store.remove(2);
    expect(await store.load(2)).toBeNull();
  });

  it('backs up an unreadable payload instead of losing it', async () => {
    const store = new MemorySaveStore();
    const raw = { schemaVersion: 99, savedAt: 1, game: {} };
    store.injectRaw(3, raw);

    await expect(store.load(3)).rejects.toBeInstanceOf(SaveMigrationError);
    expect(store.readBackup(3)).toEqual(raw);
    expect((await store.list())[2]?.label).toBe('ПОВРЕЖДЁН');
  });

  it('rejects invalid slot numbers', async () => {
    const store = new MemorySaveStore();
    await expect(store.load(0)).rejects.toThrow(RangeError);
    await expect(store.save(4, {
      schemaVersion: 2,
      savedAt: 0,
      game: makeSim().exportState(),
    })).rejects.toThrow(RangeError);
  });
});

describe('simulation state round-trip', () => {
  it('restores an identical authoritative state in a fresh simulation', () => {
    const original = makeSim();
    const base = original.world.bases[0]!;
    original.world.bases[0]!.structures.push(createWorkshop(original.time.tick));
    original.world.vehicle.position = new Vec2(base.x, base.y);
    original.world.vehicle.velocity = Vec2.ZERO;
    original.world.economy.cargo.scrap = 100;
    original.world.economy.cargo.fuel = 50;
    original.queueEquipmentAction({ kind: 'upgrade', track: 'engine' });
    original.step();
    original.step();
    original.world.economy.cargo.scrap = 17;
    original.world.economy.depletion['starter-scrap'] = 5;

    const state = original.exportState();
    const restored = new Simulation(createConfig());
    restored.importState(state);

    expect(JSON.stringify(restored.exportState())).toBe(JSON.stringify(state));
    expect(restored.time.tick).toBe(original.time.tick);
    expect(restored.world.garage.levels.engine).toBe(1);
    expect(restored.world.economy.cargo.scrap).toBe(17);
    expect(restored.snapshot().economy.cargo.scrap).toBe(17);
  });

  it('restores magazine ammunition and depot contents', () => {
    const original = makeSim();
    // The garage slot owns the rounds; combat mirrors it every tick.
    original.world.garage.slots[0]!.ammoInMagazine = 7;
    original.world.combat.weapons[0]!.ammoInMagazine = 7;
    original.world.bases[0]!.storage.scrap = 42;
    original.world.bases[0]!.structures.push(
      createWorkshop(original.time.tick),
    );

    const state = original.exportState();
    const restored = new Simulation(createConfig());
    restored.importState(state);

    expect(restored.world.combat.weapons[0]?.ammoInMagazine).toBe(7);
    expect(restored.world.garage.slots[0]?.ammoInMagazine).toBe(7);
    expect(restored.world.bases[0]?.storage.scrap).toBe(42);
    expect(restored.world.bases[0]?.structures[0]?.kind).toBe('workshop');
  });

  it('does not heal a damaged car when armour is restored', () => {
    const original = makeSim();
    original.world.garage.slots[2]!.moduleId = 'reinforced-plating';
    original.world.vehicleHealth = 70;
    original.world.vehicleMaxHealth = resolveVehicleStats(
      original.config.vehicle,
      original.world.garage,
    ).maxHealth;

    const restored = new Simulation(createConfig());
    restored.importState(original.exportState());

    expect(restored.world.vehicleMaxHealth).toBe(original.world.vehicleMaxHealth);
    expect(restored.world.vehicleHealth).toBe(70);
    expect(restored.snapshot().vehicle.health).toBe(70);
  });

  it('continues deterministically after a load', () => {
    const original = makeSim();
    original.stepMany(30);
    const state = original.exportState();

    const restored = new Simulation(createConfig());
    restored.importState(state);
    for (const simulation of [original, restored]) {
      simulation.queueControls({ brake: 1 }, simulation.time.tick + 1);
      simulation.stepMany(45);
    }

    expect(JSON.stringify(restored.exportState())).toBe(
      JSON.stringify(original.exportState()),
    );
  });

  it('refuses a corrupted state before touching the world', () => {
    const simulation = makeSim();
    const before = JSON.stringify(simulation.exportState());
    expect(() => simulation.importState({ ...simulation.exportState(), tick: -1 } as never)).toThrow(/Cannot load save/);
    expect(JSON.stringify(simulation.exportState())).toBe(before);
  });
});

function createWorkshop(builtTick: number) {
  return {
    id: 'struct-workshop',
    kind: 'workshop' as const,
    x: 10,
    y: 5,
    slotIndex: 0,
    builtTick,
    active: true,
    condition: 3,
    deficitSeconds: 0,
    upkeepProgress: 0,
    productionProgress: 0,
    producedTotal: 0,
    aimAngle: 0,
    cooldownSeconds: 0,
  };
}

describe('AutoSaveController', () => {
  it('saves on the tick interval', () => {
    let calls = 0;
    const controller = new AutoSaveController(() => { calls += 1; }, { intervalTicks: 10 });
    controller.reset(signals(0));
    expect(controller.observe(signals(1))).toBe(false);
    expect(controller.observe(signals(10))).toBe(true);
    expect(controller.observe(signals(11))).toBe(false);
    expect(calls).toBe(1);
  });

  it('saves immediately on a significant event', () => {
    let calls = 0;
    const controller = new AutoSaveController(() => { calls += 1; }, { intervalTicks: 1000 });
    controller.reset(signals(5));
    expect(controller.observe(signals(6, { structureCount: 1 }))).toBe(true);
    expect(controller.observe(signals(7, { structureCount: 1 }))).toBe(false);
    expect(calls).toBe(1);
  });

  it('does not fire for the initial state after a load', () => {
    const controller = new AutoSaveController(() => {
      throw new Error('must not save');
    });
    controller.reset(signals(42, { garageRevision: 3 }));
    expect(controller.observe(signals(43, { garageRevision: 3 }))).toBe(false);
  });
});
