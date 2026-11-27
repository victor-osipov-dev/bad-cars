/**
 * Garage state and the pure rules that operate on it.
 *
 * The garage owns three things: which module sits in each equipment slot, the
 * progression levels, and the module locker (everything the player owns but has
 * not fitted). All functions here are pure or mutate the passed state directly
 * — no clock, no RNG, no rendering — so the whole progression system is
 * replayable from a command stream.
 *
 * Derived stats are always recomputed from scratch (`resolveVehicleStats`),
 * never patched incrementally, which keeps "install then remove" exactly
 * reversible.
 */

import type { StructureKind } from '../../data/bases';
import {
  EQUIPMENT_MODULES,
  EQUIPMENT_SLOTS,
  GARAGE_CONFIG,
  UPGRADE_TRACKS,
  UPGRADE_TRACK_KINDS,
  type EquipmentModuleDefinition,
  type GarageConfig,
  type UpgradeTrack,
  type VehicleBaseStats,
  type VehicleStatModifier,
} from '../../data/garage';
import { INVENTORY_CONFIG } from '../../data/resources';
import type { ResourceAmounts } from '../economy/EconomyState';
import { canAffordFrom, payCostFrom } from '../base/BaseState';
import { DEFAULT_LOADOUT, WEAPON_CONFIGS, type WeaponSlotConfig } from '../../data/weapons';
import type { VehicleConfig } from '../../data/vehicles';

/** One record per equipment slot; `moduleId` is null while the bay is empty. */export interface EquipmentSlotState {
  readonly slotId: string;
  moduleId: string | null;
  /** Rounds currently chambered (weapon slots only). */
  ammoInMagazine: number;
  /** Rounds kept with the module while it is fitted (weapon slots only). */
  reserveAmmo: number;
}

/** A module the player owns but has not fitted. */
export interface LockerEntry {
  readonly moduleId: string;
  ammoInMagazine: number;
  reserveAmmo: number;
}

export interface GarageState {
  slots: EquipmentSlotState[];
  /** HUD/menu cursor: index into `slots`. */
  selectedSlot: number;
  /** Current level per upgrade track. */
  levels: Record<UpgradeTrack, number>;
  /** Owned but unfitted modules, with their stored ammunition. */
  locker: LockerEntry[];
  /** Last refused action, for HUD feedback; cleared on the next success. */
  lastRefusal: GarageRefusal | null;
  /** Cached derived stats, refreshed by the garage system every tick. */
  stats: ResolvedVehicleStats;
  /**
   * Bumped on every successful install/remove/upgrade.
   *
   * Lets `Simulation` publish stat changes (trunk capacity, armour) exactly
   * once per real change, instead of rewriting the world every tick.
   */
  revision: number;
}

/** Why an install/remove/upgrade request was refused; null means success. */
export type GarageRefusal =
  | 'no-base'
  | 'no-workshop'
  | 'unknown-slot'
  | 'unknown-module'
  | 'wrong-slot-kind'
  | 'workshop-level'
  | 'not-enough-resources'
  | 'slot-occupied'
  | 'slot-empty'
  | 'locker-missing'
  | 'max-level'
  | 'unknown-track';

export interface GarageActionResult {
  readonly ok: boolean;
  readonly reason: GarageRefusal | null;
}

function ok(): GarageActionResult {
  return { ok: true, reason: null };
}

function refuse(reason: GarageRefusal): GarageActionResult {
  return { ok: false, reason };
}

/** Fresh garage: weapon hardpoints pre-filled from the starter loadout. */
export function createGarageState(
  vehicle: VehicleConfig,
  loadout: readonly WeaponSlotConfig[] = DEFAULT_LOADOUT,
): GarageState {
  let weaponIndex = 0;
  const slots: EquipmentSlotState[] = EQUIPMENT_SLOTS.map((slot) => {
    if (slot.kind !== 'weapon') {
      return { slotId: slot.id, moduleId: null, ammoInMagazine: 0, reserveAmmo: 0 };
    }
    const entry = loadout[weaponIndex];
    weaponIndex += 1;
    if (!entry) {
      return { slotId: slot.id, moduleId: null, ammoInMagazine: 0, reserveAmmo: 0 };
    }
    return {
      slotId: slot.id,
      moduleId: entry.weaponId,
      ammoInMagazine: WEAPON_CONFIGS[entry.weaponId]?.magazineSize ?? 0,
      reserveAmmo: entry.reserveAmmo,
    };
  });

  const garage: GarageState = {
    slots,
    selectedSlot: 0,
    levels: { engine: 0, chassis: 0, workshop: 0 },
    locker: [],
    lastRefusal: null,
    revision: 0,
    // Placeholder; overwritten below once the object exists.
    stats: {
      armor: 0,
      cargoCapacity: INVENTORY_CONFIG.cargoCapacity,
      harvestBonus: 0,
      radarBonus: 0,
      maxHealth: vehicle.durability.maxHealth,
      maxForwardSpeed: vehicle.physics.maxForwardSpeed,
      engineAcceleration: vehicle.physics.engineAcceleration,
    },
  };
  garage.stats = resolveVehicleStats(vehicle, garage);
  return garage;
}

export function findSlot(
  garage: GarageState,
  slotId: string,
): EquipmentSlotState | null {
  return garage.slots.find((slot) => slot.slotId === slotId) ?? null;
}

export function workshopLevel(garage: GarageState): number {
  return garage.levels.workshop;
}

/** Every modifier the vehicle currently benefits from: modules + upgrades. */
export function collectModifiers(garage: GarageState): VehicleStatModifier[] {
  const sources: VehicleStatModifier[] = [];

  for (const slot of garage.slots) {
    if (!slot.moduleId) continue;
    const module = EQUIPMENT_MODULES[slot.moduleId];
    if (module?.modifiers) sources.push(module.modifiers);
  }

  for (const track of UPGRADE_TRACK_KINDS) {
    const level = garage.levels[track];
    for (const entry of UPGRADE_TRACKS[track]) {
      if (entry.level <= level) sources.push(entry.modifiers);
    }
  }

  return sources;
}

export interface ResolvedVehicleStats extends VehicleBaseStats {
  /** Total structural hit points, base durability plus armour plating. */
  readonly maxHealth: number;
  readonly maxForwardSpeed: number;
  readonly engineAcceleration: number;
}

function clampStat(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Recomputes every derived stat from the base configuration and the garage.
 *
 * Called after any change, so an install/remove round-trip is exact and a
 * partially applied upgrade can never leave stale numbers behind.
 */
export function resolveVehicleStats(
  vehicle: VehicleConfig,
  garage: GarageState,
  config: GarageConfig = GARAGE_CONFIG,
): ResolvedVehicleStats {
  let armor = 0;
  let cargo = INVENTORY_CONFIG.cargoCapacity;
  let harvestBonus = 0;
  let radarBonus = 0;
  let maxForwardSpeed = vehicle.physics.maxForwardSpeed;
  let engineAcceleration = vehicle.physics.engineAcceleration;

  for (const modifier of collectModifiers(garage)) {
    armor += modifier.armor ?? 0;
    cargo += modifier.cargoCapacity ?? 0;
    harvestBonus += modifier.harvestBonus ?? 0;
    radarBonus += modifier.radarBonus ?? 0;
    maxForwardSpeed += modifier.maxForwardSpeed ?? 0;
    engineAcceleration += modifier.engineAcceleration ?? 0;
  }

  return {
    armor,
    cargoCapacity: clampStat(
      Math.round(cargo),
      1,
      config.maxCargoCapacity,
    ),
    harvestBonus: clampStat(harvestBonus, 0, config.maxHarvestBonus),
    radarBonus: clampStat(radarBonus, 0, config.maxRadarBonus),
    maxHealth: vehicle.durability.maxHealth + clampStat(armor, 0, config.maxArmor),
    maxForwardSpeed,
    engineAcceleration,
  };
}

/**
 * Applies resolved stats to a vehicle configuration.
 *
 * Returns a new config so nothing mutates the shared, frozen data module; the
 * movement system and the durability system both read from here.
 */
export function applyStatsToVehicle(
  vehicle: VehicleConfig,
  stats: ResolvedVehicleStats,
): VehicleConfig {
  return {
    ...vehicle,
    physics: {
      ...vehicle.physics,
      maxForwardSpeed: stats.maxForwardSpeed,
      engineAcceleration: stats.engineAcceleration,
    },
    durability: {
      ...vehicle.durability,
      maxHealth: stats.maxHealth,
    },
  };
}

/** Weapon loadout for `createCombat`, in slot order. */
export function resolveLoadout(garage: GarageState): readonly WeaponSlotConfig[] {
  const loadout: WeaponSlotConfig[] = [];

  for (const slot of garage.slots) {
    if (!slot.moduleId) continue;
    const module = EQUIPMENT_MODULES[slot.moduleId];
    if (!module?.weaponId) continue;
    loadout.push({ weaponId: module.weaponId, reserveAmmo: slot.reserveAmmo });
  }

  return loadout;
}

/** Munition state a combat weapon slot exposes to the garage. */
export interface CombatAmmoState {
  readonly weaponId: string;
  ammoInMagazine: number;
  reserveAmmo: number;
}

/**
 * Copies live magazine/reserve state back into the fitted modules.
 *
 * Ammunition is authoritative in `CombatState` while a weapon is mounted, so
 * this must run before any loadout change; otherwise swapping a weapon would
 * silently reset the rounds it had loaded.
 */
export function storeCombatAmmo(
  garage: GarageState,
  weapons: readonly CombatAmmoState[],
): void {
  let weaponIndex = 0;
  for (const slot of garage.slots) {
    const module = slot.moduleId ? EQUIPMENT_MODULES[slot.moduleId] : null;
    if (!module?.weaponId) continue;
    const combatSlot = weapons[weaponIndex];
    weaponIndex += 1;
    if (!combatSlot) continue;
    slot.ammoInMagazine = Math.max(0, Math.floor(combatSlot.ammoInMagazine));
    slot.reserveAmmo = Math.max(0, Math.floor(combatSlot.reserveAmmo));
  }
}

/** True when the garage loadout differs from what the combat state holds. */
export function loadoutMatches(
  garage: GarageState,
  weapons: readonly { readonly weaponId: string }[],
): boolean {
  const expected = resolveLoadout(garage);
  if (expected.length !== weapons.length) return false;
  return expected.every((slot, index) => weapons[index]?.weaponId === slot.weaponId);
}

export function moduleForSlotKind(
  garage: GarageState,
  slotId: string,
): EquipmentModuleDefinition | null {
  const slot = findSlot(garage, slotId);
  if (!slot?.moduleId) return null;
  return EQUIPMENT_MODULES[slot.moduleId] ?? null;
}

export interface GarageContext {
  /** Base the car is parked at, or null when no base is in reach. */
  readonly atBase: boolean;
  /** True when that base has the required service structure built. */
  readonly hasWorkshop: boolean;
  readonly cargo: ResourceAmounts;
  /**
   * Depot of the base being serviced, when there is one.
   *
   * Garage work happens at the base, so stored material is spent before the
   * truck's cargo. The truck remains the fallback for a freshly founded camp.
   */
  readonly storage?: ResourceAmounts;
}

/** Wallets in spending order: base depot first, then carried cargo. */
function wallets(context: GarageContext): ResourceAmounts[] {
  return context.storage ? [context.storage, context.cargo] : [context.cargo];
}

/**
 * Validates fitting `moduleId` into `slotId` without changing anything.
 *
 * Checks run in the order the player would discover them: is there a base,
 * does it have a workshop, does the slot exist, is the module the right kind,
 * is the workshop high enough, can we pay, and is the bay free.
 */
export function validateInstall(
  garage: GarageState,
  context: GarageContext,
  slotId: string,
  moduleId: string,
  config: GarageConfig = GARAGE_CONFIG,
): GarageActionResult {
  if (config.serviceStructure !== null && !context.atBase) return refuse('no-base');
  if (!context.hasWorkshop) return refuse('no-workshop');

  const slot = findSlot(garage, slotId);
  if (!slot) return refuse('unknown-slot');

  const module = EQUIPMENT_MODULES[moduleId];
  if (!module) return refuse('unknown-module');

  const slotDefinition = EQUIPMENT_SLOTS.find((entry) => entry.id === slotId);
  if (!slotDefinition || slotDefinition.kind !== module.slotKind) {
    return refuse('wrong-slot-kind');
  }

  if (workshopLevel(garage) < module.requiredWorkshopLevel) {
    return refuse('workshop-level');
  }
  if (!canAffordFrom(wallets(context), module.cost)) return refuse('not-enough-resources');
  if (slot.moduleId !== null) return refuse('slot-occupied');

  return ok();
}

/**
 * Fits a module, paying its cost from the base depot first, then cargo.
 *
 * A module already in the locker arrives with the ammunition it was stored
 * with; a newly bought one arrives loaded. Rounds therefore travel with the
 * module, so swapping weapons never creates or destroys ammunition.
 */
export function installModule(
  garage: GarageState,
  context: GarageContext,
  slotId: string,
  moduleId: string,
  config: GarageConfig = GARAGE_CONFIG,
): GarageActionResult {
  const verdict = validateInstall(garage, context, slotId, moduleId, config);
  if (!verdict.ok) return verdict;

  const slot = findSlot(garage, slotId);
  const module = EQUIPMENT_MODULES[moduleId];
  if (!slot || !module) return refuse('unknown-module');
  if (!payCostFrom(wallets(context), module.cost)) return refuse('not-enough-resources');

  const lockerIndex = garage.locker.findIndex((entry) => entry.moduleId === moduleId);
  const stored = lockerIndex >= 0 ? garage.locker[lockerIndex] : null;
  if (lockerIndex >= 0) garage.locker.splice(lockerIndex, 1);

  slot.moduleId = moduleId;
  slot.ammoInMagazine =
    stored?.ammoInMagazine ?? WEAPON_CONFIGS[module.weaponId ?? '']?.magazineSize ?? 0;
  slot.reserveAmmo = stored?.reserveAmmo ?? module.reserveAmmo ?? 0;
  garage.revision += 1;
  return ok();
}

/** Returns the fitted module to the locker; ammunition travels with it. */
export function removeModule(
  garage: GarageState,
  context: GarageContext,
  slotId: string,
  config: GarageConfig = GARAGE_CONFIG,
): GarageActionResult {
  if (config.serviceStructure !== null && !context.atBase) return refuse('no-base');
  if (!context.hasWorkshop) return refuse('no-workshop');

  const slot = findSlot(garage, slotId);
  if (!slot) return refuse('unknown-slot');
  if (slot.moduleId === null) return refuse('slot-empty');

  garage.locker.push({
    moduleId: slot.moduleId,
    ammoInMagazine: slot.ammoInMagazine,
    reserveAmmo: slot.reserveAmmo,
  });
  slot.moduleId = null;
  slot.ammoInMagazine = 0;
  slot.reserveAmmo = 0;
  garage.revision += 1;
  return ok();
}

/** Discards a locker entry for good (scrapping). */
export function discardFromLocker(garage: GarageState, moduleId: string): boolean {
  const index = garage.locker.findIndex((entry) => entry.moduleId === moduleId);
  if (index < 0) return false;
  garage.locker.splice(index, 1);
  return true;
}

export interface UpgradeVerdict {
  readonly ok: boolean;
  readonly reason: GarageRefusal | null;
  /** Level the vehicle would reach, or the current level when refused. */
  readonly nextLevel: number;
  readonly cost: Partial<Record<string, number>>;
  readonly label: string;
}

/** Describes the next level of `track`, for both validation and the HUD. */
export function describeUpgrade(
  garage: GarageState,
  context: GarageContext,
  track: UpgradeTrack,
  config: GarageConfig = GARAGE_CONFIG,
): UpgradeVerdict {
  const levels = UPGRADE_TRACKS[track];
  if (!levels) {
    return { ok: false, reason: 'unknown-track', nextLevel: 0, cost: {}, label: '' };
  }

  const current = garage.levels[track];
  const next = levels.find((entry) => entry.level === current + 1);
  if (!next) {
    return {
      ok: false,
      reason: 'max-level',
      nextLevel: current,
      cost: {},
      label: 'МАКСИМУМ',
    };
  }

  const cost = next.cost;
  const verdict = ((): GarageActionResult => {
    if (config.serviceStructure !== null && !context.atBase) return refuse('no-base');
    if (!context.hasWorkshop) return refuse('no-workshop');
    if (!canAffordFrom(wallets(context), cost)) return refuse('not-enough-resources');
    return ok();
  })();

  return {
    ok: verdict.ok,
    reason: verdict.reason,
    nextLevel: next.level,
    cost,
    label: next.displayName,
  };
}

export function upgradeLevel(
  garage: GarageState,
  context: GarageContext,
  track: UpgradeTrack,
  config: GarageConfig = GARAGE_CONFIG,
): GarageActionResult {
  const verdict = describeUpgrade(garage, context, track, config);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const levels = UPGRADE_TRACKS[track];
  const next = levels.find((entry) => entry.level === verdict.nextLevel);
  if (!next) return refuse('max-level');
  if (!payCostFrom(wallets(context), next.cost)) return refuse('not-enough-resources');
  garage.levels[track] = next.level;
  garage.revision += 1;
  return ok();
}

/** Serializes the garage for saves/HUD without leaking live objects. */
export interface GarageSnapshotData {
  readonly slots: readonly {
    readonly slotId: string;
    readonly kind: 'weapon' | 'utility';
    readonly label: string;
    readonly moduleId: string | null;
    readonly moduleName: string | null;
    readonly shortName: string;
    readonly reserveAmmo: number;
  }[];
  readonly levels: Readonly<Record<UpgradeTrack, number>>;
  readonly locker: readonly { readonly moduleId: string; readonly reserveAmmo: number }[];
  readonly stats: ResolvedVehicleStats;
}

export function garageSlotKind(slotId: string): 'weapon' | 'utility' {
  return EQUIPMENT_SLOTS.find((slot) => slot.id === slotId)?.kind ?? 'utility';
}

/** True when the base has a structure that can service the vehicle. */
export function baseHasServiceStructure(
  structures: readonly { readonly kind: StructureKind }[],
  kind: StructureKind | null,
): boolean {
  if (kind === null) return true;
  return structures.some((structure) => structure.kind === kind);
}

export type { StructureKind };
