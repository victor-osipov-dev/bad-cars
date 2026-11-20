import { clampCargo } from './economy/EconomyState';
import { SeededRandom } from '../core/math/rng';
import { Vec2 } from '../core/math/Vec2';
import { GameTime } from '../core/time/GameTime';
import { GAME_CONFIG, type GameplayConfig } from '../data/gameplay';
import { ECONOMY_CONFIG } from '../data/economy';
import { validateWorldConfig } from '../data/worldgen';
import { assertValidVehicleConfig, type VehicleConfig } from '../data/vehicles';
import { validateLoadout, WEAPON_CONFIGS } from '../data/weapons';
import { EQUIPMENT_MODULES, GARAGE_CONFIG, validateGarageConfig } from '../data/garage';
import {
  applyStatsToVehicle,
  loadoutMatches,
  resolveLoadout,
  resolveVehicleStats,
  storeCombatAmmo,
} from './garage/GarageState';
import { EquipmentCommandQueue } from './input/EquipmentCommandQueue';
import type { EquipmentAction, EquipmentCommand } from './input/EquipmentCommand';
import { createCombatState } from './combat/createCombatState';
import {
  createAimControls,
  type AimCommand,
  type AimControls,
} from './input/AimCommand';
import { AimCommandQueue } from './input/AimCommandQueue';
import {
  createDriveControls,
  type DriveCommand,
  type DriveControls,
} from './input/DriveCommand';
import { CommandQueue } from './input/CommandQueue';
import type { SimulationContext, System } from './System';
import { ChunkStreamingSystem } from './systems/ChunkStreamingSystem';
import { EffectsSystem } from './systems/EffectsSystem';
import { BaseSystem } from './systems/BaseSystem';
import { GarageSystem } from './systems/GarageSystem';
import { DefenseSystem } from './systems/DefenseSystem';
import { EconomySystem, baseEconomyRates } from './systems/EconomySystem';
import { RemoteSimulationSystem } from './systems/RemoteSimulationSystem';
import { RaidSystem } from './systems/RaidSystem';
import { idleSensors, SensorSystem } from './systems/SensorSystem';
import { ResourceSystem } from './systems/ResourceSystem';
import { EnemySystem } from './systems/EnemySystem';
import { ProjectileSystem } from './systems/ProjectileSystem';
import { VehicleDurabilitySystem } from './systems/VehicleDurabilitySystem';
import { VehicleMovementSystem } from './systems/VehicleMovementSystem';
import { WeaponSystem } from './systems/WeaponSystem';
import { cargoTotal } from './economy/EconomyState';
import { storageTotal as baseStorageTotal } from './base/BaseState';
import { vehicleKinematics } from './vehicle/stepVehicle';
import type {
  CombatSnapshot,
  WorldSnapshot,
  WorldState,
} from './world/WorldState';
import { createPlaygroundWorld } from './world/createPlaygroundWorld';
import {
  SERIALIZED_INFINITY,
  type SerializedGameState,
} from './persistence/SerializedGameState';
import { validateSerializedGameState } from '../save/validateSave';

/**
 * Deterministic, render-independent game simulation.
 *
 * Contract:
 * - no Babylon.js or DOM imports;
 * - only advances through `step()` at the configured fixed step;
 * - all randomness comes from the seeded RNG;
 * - player input arrives as tick-stamped drive and aim commands;
 * - `snapshot()` is a serializable view for the renderer and save system.
 */
export class Simulation {
  readonly config: GameplayConfig;
  readonly time: GameTime;
  readonly rng: SeededRandom;
  readonly world: WorldState;

  readonly #context: SimulationContext;
  readonly #systems: readonly System[];
  readonly #commands: CommandQueue;
  readonly #aimCommands: AimCommandQueue;
  readonly #equipmentCommands: EquipmentCommandQueue;
  readonly #remote: RemoteSimulationSystem;
  /**
   * Vehicle configuration with garage stats applied.
   *
   * Systems read this rather than `config.vehicle`, so an engine or armour
   * upgrade takes effect on the next tick without mutating shared data.
   */
  #resolvedVehicle: VehicleConfig;
  /** Garage revision already published to the economy/health limits. */
  #lastGarageRevision = 0;

  constructor(config: GameplayConfig = GAME_CONFIG) {
    assertValidVehicleConfig(config.vehicle);
    const worldErrors = validateWorldConfig(config.world);
    if (worldErrors.length > 0) {
      throw new Error(`Invalid world config: ${worldErrors.join('; ')}`);
    }
    const loadoutErrors = validateLoadout(config.loadout);
    if (loadoutErrors.length > 0) {
      throw new Error(`Invalid loadout: ${loadoutErrors.join('; ')}`);
    }
    const garageErrors = validateGarageConfig(GARAGE_CONFIG);
    if (garageErrors.length > 0) {
      throw new Error(`Invalid garage config: ${garageErrors.join('; ')}`);
    }

    this.config = config;
    this.time = new GameTime({
      fixedStepSeconds: 1 / config.fixedStepHz,
      dayLengthSeconds: config.dayLengthSeconds,
    });
    this.rng = new SeededRandom(config.worldSeed);
    this.world = createPlaygroundWorld(config);
    this.#resolvedVehicle = applyStatsToVehicle(config.vehicle, this.world.garage.stats);
    this.#commands = new CommandQueue(0);
    this.#aimCommands = new AimCommandQueue(0);
    this.#equipmentCommands = new EquipmentCommandQueue();

    this.#context = {
      config,
      time: this.time,
      world: this.world,
      rng: this.rng,
      vehicle: this.#resolvedVehicle,
      garage: this.world.garage,
    };

    // Bases near the player run the full economy every tick; far ones are
    // advanced by the remote system in coarse, budgeted ticks.
    const economy = new EconomySystem(
      ECONOMY_CONFIG,
      config.remote.remoteRadius,
    );
    this.#remote = new RemoteSimulationSystem(economy, config.remote);

    // System order is explicit and stable for determinism.
    this.#systems = [
      new ChunkStreamingSystem(),
      new VehicleMovementSystem(),
      new WeaponSystem(),
      new ProjectileSystem(),
      new EnemySystem(),
      // Upkeep is resolved before defence acts so an unpowered turret never
      // gets a free shot on the tick its fuel runs out.
      new BaseSystem(),
      economy,
      // The garage runs right after base building so a structure founded this
      // tick is immediately usable, and before combat so weapon swaps apply.
      new GarageSystem(GARAGE_CONFIG),
      new DefenseSystem(),
      new RaidSystem(config.raids),
      this.#remote,
      new SensorSystem(),
      new VehicleDurabilitySystem(),
      new ResourceSystem(),
      new EffectsSystem(),
    ];
  }

  /** Queues a drive command; it applies when the simulation reaches `tick`. */
  queueCommand(command: DriveCommand): void {
    this.#commands.enqueue(command);
  }

  /** Convenience wrapper for UI input: defaults to the next tick. */
  queueControls(controls: Partial<DriveControls>, tick = this.time.tick + 1): void {
    this.#commands.enqueue({
      ...createDriveControls(controls),
      tick,
    });
  }

  /** Queues an aim/fire command; it applies when the simulation reaches `tick`. */
  queueAimCommand(command: AimCommand): void {
    this.#aimCommands.enqueue(command);
  }

  /**
   * Queues a garage action; it applies on the next tick.
   *
   * Garage actions are events, not held state, so they are drained rather than
   * kept active: two upgrades queued together both apply, in order.
   */
  queueEquipmentAction(action: EquipmentAction, tick = this.time.tick + 1): void {
    this.#equipmentCommands.enqueue({ tick, action });
  }

  /** Convenience wrapper for UI input; defaults to the next tick. */
  queueEquipmentCommand(command: EquipmentCommand): void {
    this.#equipmentCommands.enqueue(command);
  }

  /** Convenience wrapper for UI input: defaults to the next tick. */
  queueAimControls(controls: Partial<AimControls>, tick = this.time.tick + 1): void {
    this.#aimCommands.enqueue({
      ...createAimControls(controls),
      tick,
    });
  }

  get pendingCommands(): number {
    return this.#commands.pendingCount;
  }

  get pendingAimCommands(): number {
    return this.#aimCommands.pendingCount;
  }

  /** Advances exactly one fixed tick. */
  step(): void {
    this.time.advanceStep();
    this.world.controls = this.#commands.advanceTo(this.time.tick);
    this.world.aim = this.#aimCommands.advanceTo(this.time.tick);
    this.world.equipmentActions = this.#equipmentCommands.drain(this.time.tick);

    for (const system of this.#systems) {
      system.update(this.#context, this.time.fixedStepSeconds);
    }

    this.#refreshResolvedVehicle();
  }

  /**
   * Republishes garage-derived stats to the systems.
   *
   * Runs after every tick (not only when the garage acted) because combat
   * ammunition drains outside `GarageSystem`; the write-back is a few integer
   * assignments on a four-element list, so it is not worth change-tracking.
   */
  #refreshResolvedVehicle(): void {
    const garage = this.world.garage;
    storeCombatAmmo(garage, this.world.combat.weapons);
    this.#resolvedVehicle = applyStatsToVehicle(this.config.vehicle, garage.stats);
    this.#context.vehicle = this.#resolvedVehicle;

    // The trunk limit follows the fitted modules; a removed cargo-expander
    // immediately shrinks the hold (and dumps whatever no longer fits). The
    // revision guard keeps this from fighting a manual override (tests).
    if (garage.revision !== this.#lastGarageRevision) {
      this.#lastGarageRevision = garage.revision;
      // Only rewrite (and re-trim) when the limit itself moved, so unrelated
      // garage actions and manual overrides are left alone.
      if (this.world.economy.cargoCapacity !== garage.stats.cargoCapacity) {
        this.world.economy.cargoCapacity = garage.stats.cargoCapacity;
        clampCargo(this.world.economy);
      }
    }

    if (!loadoutMatches(garage, this.world.combat.weapons)) {
      const heading = this.world.combat.aimAngle;
      this.world.combat = createCombatState(resolveLoadout(garage), heading);
    }
  }

  /**
   * Fast-forwards remote bases by `elapsedSeconds` of world time.
   *
   * Used when loading a save: the world advances without stepping the local
   * simulation, and the work is capped so a long absence cannot freeze the
   * frame. The result reports whether the requested span was fully covered.
   */
  catchUp(elapsedSeconds: number): { ticks: number; truncated: boolean } {
    return this.#remote.catchUp(this.#context, elapsedSeconds);
  }

  /** Runs `count` fixed ticks; handy for tests, catch-up and remote sim. */
  stepMany(count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError('count must be a non-negative integer');
    }
    for (let i = 0; i < count; i += 1) {
      this.step();
    }
  }

  snapshot(): WorldSnapshot {
    const { vehicle, arena, props } = this.world;
    const kinematics = vehicleKinematics(vehicle);

    return {
      tick: this.time.tick,
      elapsedSeconds: this.time.elapsedSeconds,
      dayIndex: this.time.dayIndex,
      dayPhase: this.time.dayPhase,
      hourOfDay: this.time.hourOfDay,
      arena: { halfWidth: arena.halfWidth, halfHeight: arena.halfHeight },
      minimap: {
        halfWidth: this.config.world.halfWidth,
        halfHeight: this.config.world.halfHeight,
        chunks: this.world.chunks.map((chunk) => ({
          key: chunk.key,
          chunkX: chunk.coord.x,
          chunkY: chunk.coord.y,
          size: chunk.size,
          biome: chunk.biome,
        })),
        centerChunk: {
          x: this.world.streamingCenter.x,
          y: this.world.streamingCenter.y,
        },
      },
      chunks: { ...this.world.chunkStats },
      economy: {
        cargo: { ...this.world.economy.cargo },
        storage: { ...(this.#focusedBase()?.storage ?? { scrap: 0, fuel: 0, water: 0 }) },
        cargoCapacity: this.world.economy.cargoCapacity,
        cargoTotal: cargoTotal(this.world.economy),
        storageTotal: (() => {
          const base = this.#focusedBase();
          return base ? baseStorageTotal(base) : 0;
        })(),
        resourceNodes: this.world.resourceNodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          x: node.x,
          y: node.y,
          remaining: node.remaining,
          maxAmount: node.maxAmount,
        })),
        interaction: this.world.interaction,
      },
      vehicle: {
        x: vehicle.position.x,
        y: vehicle.position.y,
        heading: vehicle.heading,
        width: this.config.vehicle.body.width,
        height: this.config.vehicle.body.length,
        speed: kinematics.speed,
        forwardSpeed: kinematics.forwardSpeed,
        steering: vehicle.steering,
        brake: this.world.controls.brake,
        handbrake: this.world.controls.handbrake,
        health: this.world.vehicleHealth,
        maxHealth: this.world.vehicleMaxHealth,
        destroyed: this.world.vehicleDestroyed,
      },
      props: props.map((prop) => ({
        id: prop.id,
        kind: prop.kind,
        x: prop.x,
        y: prop.y,
        rotation: prop.rotation,
        scale: prop.scale,
      })),
      baseState: {
        bases: this.world.bases.map((base, index) => ({
          id: base.id,
          name: base.name,
          x: base.x,
          y: base.y,
          structures: base.structures.map((structure) => ({
            id: structure.id,
            kind: structure.kind,
            x: structure.x,
            y: structure.y,
            active: structure.active,
            condition: structure.condition,
            maxCondition: ECONOMY_CONFIG.maxCondition,
            aimAngle: structure.aimAngle,
          })),
          storage: { ...base.storage },
          selected: index === this.world.selectedBaseIndex,
          captured: base.captured,
          economy: (() => {
            const rates = baseEconomyRates(base);
            return {
              netPerMinute: { ...rates.netPerMinute },
              upkeepPerMinute: { ...rates.upkeepPerMinute },
              productionPerMinute: { ...rates.productionPerMinute },
              inactiveStructures: rates.inactiveStructures,
              scrappedTotal: base.scrappedCount,
              minesSpent: base.minesSpent,
            };
          })(),
        })),
        build: this.world.buildInfo,
        sensors: this.world.sensors,
        raids: this.world.raids.map((raid) => ({
          id: raid.id,
          baseName: raid.baseName,
          phase: raid.phase,
          secondsRemaining: raid.secondsRemaining,
          attackers: raid.attackers,
          looted: Math.floor(raid.looted),
        })),
        remote: {
          ticks: this.world.remoteTicks,
          reports: this.world.remoteReports.map((report) => ({ ...report })),
        },
        reports: this.world.raidReports.map((report) => ({
          id: report.id,
          baseName: report.baseName,
          outcome: report.outcome,
          live: report.live,
          looted: report.looted,
          structuresLost: report.structuresLost,
        })),
      },
      garage: {
        info: this.world.garageInfo,
        levels: { ...this.world.garage.levels },
        stats: {
          armor: this.world.garage.stats.armor,
          cargoCapacity: this.world.garage.stats.cargoCapacity,
          harvestBonus: this.world.garage.stats.harvestBonus,
          radarBonus: this.world.garage.stats.radarBonus,
          maxForwardSpeed: this.world.garage.stats.maxForwardSpeed,
          engineAcceleration: this.world.garage.stats.engineAcceleration,
        },
      },
      combat: this.#combatSnapshot(),
    };
  }


  /**
   * Exports the authoritative state needed to resume a run.
   *
   * Transient visuals (projectiles, effects) and derived HUD data are
   * deliberately excluded. `structuredClone` keeps the returned value from
   * aliasing live simulation objects, so callers may edit it freely.
   */
  exportState(): SerializedGameState {
    const world = this.world;
    const garage = world.garage;
    const state: SerializedGameState = {
      config: structuredClone(this.config),
      tick: this.time.tick,
      rngState: this.rng.state,
      controls: { ...world.controls },
      aim: {
        aimPoint: world.aim.aimPoint ? { ...world.aim.aimPoint } : null,
        fire: world.aim.fire,
        activeSlot: world.aim.activeSlot,
        reloadToken: world.aim.reloadToken,
      },
      nextIds: {
        projectile: world.nextProjectileId,
        effect: world.nextEffectId,
        enemy: world.nextEnemyId,
      },
      vehicle: {
        x: world.vehicle.position.x,
        y: world.vehicle.position.y,
        heading: world.vehicle.heading,
        steering: world.vehicle.steering,
        vx: world.vehicle.velocity.x,
        vy: world.vehicle.velocity.y,
        health: world.vehicleHealth,
        destroyed: world.vehicleDestroyed,
        respawnRemainingSeconds: world.vehicleRespawnRemainingSeconds,
      },
      garage: {
        slots: garage.slots.map((slot) => ({
          slotId: slot.slotId,
          moduleId: slot.moduleId,
          ammoInMagazine: slot.ammoInMagazine,
          reserveAmmo: slot.reserveAmmo,
        })),
        selectedSlot: garage.selectedSlot,
        levels: { ...garage.levels },
        locker: garage.locker.map((entry) => ({ ...entry })),
      },
      economy: {
        cargo: { ...world.economy.cargo },
        depletion: { ...world.economy.depletion },
      },
      bases: {
        selectedBaseIndex: world.selectedBaseIndex,
        items: world.bases.map((base) => ({
          id: base.id,
          siteId: base.siteId,
          name: base.name,
          x: base.x,
          y: base.y,
          storage: { ...base.storage },
          structures: base.structures.map((structure) => ({ ...structure })),
          foundedTick: base.foundedTick,
          scrappedCount: base.scrappedCount,
          minesSpent: base.minesSpent,
          captured: base.captured,
        })),
        raidCooldownSeconds: world.raidCooldownSeconds,
        nextRaidId: world.nextRaidId,
        raids: world.raids.map((raid) => ({
          id: raid.id,
          baseId: raid.baseId,
          baseName: raid.baseName,
          phase: raid.phase,
          secondsRemaining: raid.secondsRemaining,
          attackers: raid.attackers,
          attackerIds: [...raid.attackerIds],
          looted: raid.looted,
          damagedStructures: raid.damagedStructures,
        })),
        reports: world.raidReports.map((report) => ({ ...report })),
      },
      enemies: world.enemies.map((enemy) => ({
        id: enemy.id,
        kind: enemy.kind,
        aiState: enemy.aiState,
        stateSeconds: enemy.stateSeconds,
        bestDistance: Number.isFinite(enemy.bestDistance)
          ? enemy.bestDistance
          : SERIALIZED_INFINITY,
        stallSeconds: enemy.stallSeconds,
        patrolAngle: enemy.patrolAngle,
        aimAngle: enemy.aimAngle,
        rotation: enemy.rotation,
        raidId: enemy.raidId,
        spawnX: enemy.spawnX,
        spawnY: enemy.spawnY,
        radius: enemy.radius,
        maxHealth: enemy.maxHealth,
        x: enemy.position.x,
        y: enemy.position.y,
        health: enemy.health,
        alive: enemy.alive,
        respawnRemainingSeconds: enemy.respawnRemainingSeconds,
        fireCooldownSeconds: enemy.fireCooldownSeconds,
      })),
      remote: {
        accumulator: world.remoteAccumulator,
        ticks: world.remoteTicks,
        reports: world.remoteReports.map((report) => ({ ...report })),
        nextReportId: world.nextRemoteReportId,
      },
    };
    return structuredClone(state);
  }

  /**
   * Restores a previously exported state into this simulation.
   *
   * The same `GameTime`, RNG and context instances are kept, so the fixed-step
   * driver and renderer do not need to be rebuilt after loading a save.
   */
  importState(value: SerializedGameState): void {
    const errors = validateSerializedGameState(value);
    if (errors.length > 0) {
      throw new Error(`Cannot load save: ${errors.join('; ')}`);
    }
    const state: SerializedGameState = structuredClone(value);
    if (state.config.fixedStepHz !== this.config.fixedStepHz) {
      throw new Error('Save uses a different fixed-step rate');
    }

    const world = this.world;
    this.time.resetTo(state.tick);
    this.rng.restore(state.rngState);

    this.#commands.clear();
    this.#aimCommands.clear();
    this.#equipmentCommands.clear();

    world.vehicle.position = new Vec2(state.vehicle.x, state.vehicle.y);
    world.vehicle.velocity = new Vec2(state.vehicle.vx, state.vehicle.vy);
    world.vehicle.heading = state.vehicle.heading;
    world.vehicle.steering = state.vehicle.steering;
    world.nextProjectileId = state.nextIds.projectile;
    world.nextEffectId = state.nextIds.effect;
    world.nextEnemyId = state.nextIds.enemy;
    world.controls = createDriveControls(state.controls);
    world.aim = createAimControls(state.aim);
    world.vehicleHealth = state.vehicle.health;
    world.vehicleDestroyed = state.vehicle.destroyed;
    world.vehicleRespawnRemainingSeconds = state.vehicle.respawnRemainingSeconds;

    world.garage.slots = state.garage.slots.map((slot) => ({
      slotId: slot.slotId,
      moduleId: slot.moduleId,
      ammoInMagazine: slot.ammoInMagazine,
      reserveAmmo: slot.reserveAmmo,
    }));
    world.garage.selectedSlot = Math.min(
      world.garage.slots.length - 1,
      Math.max(0, state.garage.selectedSlot),
    );
    world.garage.levels = { ...state.garage.levels };
    world.garage.locker = state.garage.locker.map((entry) => ({ ...entry }));
    world.garage.lastRefusal = null;
    world.garage.revision += 1;
    // Publish the saved ceiling before the garage system runs; otherwise it
    // would treat the armour delta as a brand-new purchase and heal the car.
    world.vehicleMaxHealth = resolveVehicleStats(this.config.vehicle, world.garage).maxHealth;
    world.vehicleHealth = Math.min(world.vehicleHealth, world.vehicleMaxHealth);
    // Force stat publication on the next refresh without touching cargo now.
    this.#lastGarageRevision = -1;

    world.economy.cargo = { ...state.economy.cargo };
    world.economy.depletion = { ...state.economy.depletion };
    world.economy.harvestProgress = 0;
    world.economy.depositProgress = 0;

    world.bases = state.bases.items.map((base) => ({
      id: base.id,
      siteId: base.siteId,
      name: base.name,
      x: base.x,
      y: base.y,
      storage: { ...base.storage },
      structures: base.structures.map((structure) => ({ ...structure })),
      foundedTick: base.foundedTick,
      scrappedCount: base.scrappedCount,
      minesSpent: base.minesSpent,
      captured: base.captured,
    }));
    world.selectedBaseIndex = Math.min(
      Math.max(0, state.bases.selectedBaseIndex),
      Math.max(0, world.bases.length - 1),
    );
    world.raidCooldownSeconds = state.bases.raidCooldownSeconds;
    world.nextRaidId = state.bases.nextRaidId;
    world.raids = state.bases.raids.map((raid) => ({
      ...raid,
      attackerIds: [...raid.attackerIds],
    })) as typeof world.raids;
    world.raidReports = state.bases.reports.map((report) => ({ ...report }));

    type Enemy = (typeof world.enemies)[number];
    world.enemies = state.enemies.map((saved) => ({
      id: saved.id,
      kind: saved.kind as Enemy['kind'],
      aiState: saved.aiState as Enemy['aiState'],
      stateSeconds: saved.stateSeconds,
      bestDistance:
        saved.bestDistance >= SERIALIZED_INFINITY
          ? Number.POSITIVE_INFINITY
          : saved.bestDistance,
      stallSeconds: saved.stallSeconds,
      patrolAngle: saved.patrolAngle,
      aimAngle: saved.aimAngle,
      rotation: saved.rotation,
      raidId: saved.raidId,
      spawnX: saved.spawnX,
      spawnY: saved.spawnY,
      radius: saved.radius,
      maxHealth: saved.maxHealth,
      position: new Vec2(saved.x, saved.y),
      health: saved.health,
      alive: saved.alive,
      respawnRemainingSeconds: saved.respawnRemainingSeconds,
      fireCooldownSeconds: saved.fireCooldownSeconds,
    }));

    world.remoteAccumulator = state.remote.accumulator;
    world.remoteTicks = state.remote.ticks;
    world.remoteReports = state.remote.reports.map((report) => ({ ...report }));
    world.nextRemoteReportId = state.remote.nextReportId;

    world.projectiles = [];
    world.effects = [];
    world.equipmentActions = [];
    world.interaction = null;
    world.buildInfo = null;
    world.sensors = idleSensors();
    world.lastFoundToken = 0;
    world.lastBuildToken = 0;
    world.lastCycleBaseToken = 0;

    // Rebuild the weapon list from the saved loadout and copy the stored rounds
    // back into it; a save made mid-magazine must resume mid-magazine.
    world.combat = createCombatState(resolveLoadout(world.garage), state.vehicle.heading);
    let weaponIndex = 0;
    for (const slot of world.garage.slots) {
      const module = slot.moduleId ? EQUIPMENT_MODULES[slot.moduleId] : undefined;
      if (!module?.weaponId) continue;
      const weapon = world.combat.weapons[weaponIndex];
      weaponIndex += 1;
      if (!weapon) continue;
      weapon.ammoInMagazine = slot.ammoInMagazine;
      weapon.reserveAmmo = slot.reserveAmmo;
    }

    // Force chunk streaming to the saved position even if it equals the old
    // centre; mergeChunkContent reapplies the depletion map to regenerated nodes.
    world.streamingCenter = { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER };
    new ChunkStreamingSystem().update(this.#context, 0);
    this.#refreshResolvedVehicle();
    new GarageSystem(GARAGE_CONFIG).update(this.#context, 0);
  }

  /** Base whose depot the HUD shows: the selected one, if any. */
  #focusedBase() {
    return this.world.bases[this.world.selectedBaseIndex] ?? null;
  }

  #combatSnapshot(): CombatSnapshot {
    const { combat, enemies, projectiles, effects } = this.world;

    const threats = enemies.filter(
        (enemy) =>
          enemy.alive &&
          (enemy.aiState === 'chase' || enemy.aiState === 'attack'),
      ).length;

    return {
      threats,
      aimAngle: combat.aimAngle,
      aimPoint: combat.aimPoint
        ? { x: combat.aimPoint.x, y: combat.aimPoint.y }
        : null,
      activeSlot: combat.activeSlot,
      weapons: combat.weapons.map((slot) => {
        const weapon = WEAPON_CONFIGS[slot.weaponId];
        return {
          weaponId: slot.weaponId,
          shortName: weapon?.shortName ?? slot.weaponId,
          ammoInMagazine: slot.ammoInMagazine,
          reserveAmmo: slot.reserveAmmo,
          magazineSize: weapon?.magazineSize ?? 0,
          reloadSeconds: weapon?.reloadSeconds ?? 0,
          reloadRemainingSeconds: slot.reloadRemainingSeconds,
          reloading: slot.reloadRemainingSeconds > 0,
        };
      }),
      enemies: enemies.map((enemy) => ({
        id: enemy.id,
        kind: enemy.kind,
        x: enemy.position.x,
        y: enemy.position.y,
        radius: enemy.radius,
        rotation: enemy.rotation,
        health: enemy.health,
        maxHealth: enemy.maxHealth,
        alive: enemy.alive,
      })),
      projectiles: projectiles.map((projectile) => ({
        id: projectile.id,
        kind: projectile.kind,
        x: projectile.position.x,
        y: projectile.position.y,
        angle: Math.atan2(projectile.velocity.y, projectile.velocity.x),
      })),
      effects: effects.map((effect) => ({
        id: effect.id,
        kind: effect.kind,
        x: effect.x,
        y: effect.y,
        rotation: effect.rotation,
        ageSeconds: effect.ageSeconds,
        lifetimeSeconds: effect.lifetimeSeconds,
      })),
    };
  }
}
