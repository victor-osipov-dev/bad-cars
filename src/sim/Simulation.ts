import { SeededRandom } from '../core/math/rng';
import { GameTime } from '../core/time/GameTime';
import { GAME_CONFIG, type GameplayConfig } from '../data/gameplay';
import { ECONOMY_CONFIG } from '../data/economy';
import { validateWorldConfig } from '../data/worldgen';
import { assertValidVehicleConfig } from '../data/vehicles';
import { validateLoadout, WEAPON_CONFIGS } from '../data/weapons';
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
import { EconomySystem, baseEconomyRates } from './systems/EconomySystem';
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

    this.config = config;
    this.time = new GameTime({
      fixedStepSeconds: 1 / config.fixedStepHz,
      dayLengthSeconds: config.dayLengthSeconds,
    });
    this.rng = new SeededRandom(config.worldSeed);
    this.world = createPlaygroundWorld(config);
    this.#commands = new CommandQueue(0);
    this.#aimCommands = new AimCommandQueue(0);

    this.#context = {
      config,
      time: this.time,
      world: this.world,
      rng: this.rng,
    };

    // System order is explicit and stable for determinism.
    this.#systems = [
      new ChunkStreamingSystem(),
      new VehicleMovementSystem(),
      new WeaponSystem(),
      new ProjectileSystem(),
      new EnemySystem(),
      new VehicleDurabilitySystem(),
      new BaseSystem(),
      new EconomySystem(),
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

    for (const system of this.#systems) {
      system.update(this.#context, this.time.fixedStepSeconds);
    }
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
        maxHealth: this.config.vehicle.durability.maxHealth,
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
          })),
          storage: { ...base.storage },
          selected: index === this.world.selectedBaseIndex,
          economy: (() => {
            const rates = baseEconomyRates(base);
            return {
              netPerMinute: { ...rates.netPerMinute },
              upkeepPerMinute: { ...rates.upkeepPerMinute },
              productionPerMinute: { ...rates.productionPerMinute },
              inactiveStructures: rates.inactiveStructures,
              scrappedTotal: base.scrappedCount,
            };
          })(),
        })),
        build: this.world.buildInfo,
      },
      combat: this.#combatSnapshot(),
    };
  }

  /** Base whose depot the HUD shows: the selected one, if any. */
  #focusedBase() {
    return this.world.bases[this.world.selectedBaseIndex] ?? null;
  }

  #combatSnapshot(): CombatSnapshot {
    const { combat, enemies, projectiles, effects } = this.world;

    return {
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
