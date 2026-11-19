/**
 * Garage, equipment slots and vehicle progression.
 *
 * Everything a garage can do is described here as data: which slots exist,
 * which modules fit them, what they cost, and how each upgrade level scales
 * the base vehicle. The simulation only resolves the configuration — it never
 * hardcodes a module or a stat.
 */

import type { StructureKind } from './bases';
import type { ResourceKind } from './resources';
import type { WeaponConfig } from './weapons';
import { CANNON, FLAK_GUN, MACHINE_GUN, WEAPON_CONFIGS } from './weapons';

export type EquipmentSlotKind = 'weapon' | 'utility';

/** A fixed slot on the vehicle that accepts modules of one kind. */
export interface EquipmentSlotDefinition {
  readonly id: string;
  readonly kind: EquipmentSlotKind;
  readonly displayName: string;
  /** Ordering hint for the HUD (weapon slots first, then utilities). */
  readonly order: number;
}

/**
 * Two weapon hardpoints and two utility bays.
 *
 * Slots are positional and permanent: upgrades add modules, they never add
 * slots, so the loadout always serializes to a fixed-length array.
 */
export const EQUIPMENT_SLOTS: readonly EquipmentSlotDefinition[] = [
  { id: 'weapon-1', kind: 'weapon', displayName: 'ОРУДИЕ 1', order: 0 },
  { id: 'weapon-2', kind: 'weapon', displayName: 'ОРУДИЕ 2', order: 1 },
  { id: 'utility-1', kind: 'utility', displayName: 'МОДУЛЬ 1', order: 2 },
  { id: 'utility-2', kind: 'utility', displayName: 'МОДУЛЬ 2', order: 3 },
];

/** Stat keys a utility module may modify. */
export type VehicleStatKey =
  | 'armor'
  | 'cargoCapacity'
  | 'harvestBonus'
  | 'radarBonus'
  | 'maxForwardSpeed'
  | 'engineAcceleration';

export type VehicleStatModifier = Partial<Record<VehicleStatKey, number>>;

export interface EquipmentModuleDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly shortName: string;
  /** HUD / sprite tint. */
  readonly color: string;
  readonly slotKind: EquipmentSlotKind;
  /**
   * Weapon this module installs into a weapon slot.
   *
   * Present exactly for weapon modules; utility modules leave it undefined and
   * carry `modifiers` instead.
   */
  readonly weaponId?: string;
  /** Additive, multiplicative-free stat deltas for utility modules. */
  readonly modifiers?: VehicleStatModifier;
  /**
   * Rounds carried in reserve when the module is first fitted.
   *
   * Only weapon modules use it; ammo travels with the module while it sits in
   * the locker, so swapping weapons never creates or destroys ammunition.
   */
  readonly reserveAmmo?: number;
  /** Cargo cost, per resource kind (missing kinds cost nothing). */
  readonly cost: Partial<Record<ResourceKind, number>>;
  /** Workshop level required before the module can be fitted. */
  readonly requiredWorkshopLevel: number;
}

/**
 * Weapon hardpoint modules wrap the weapon catalogue, so a new weapon becomes
 * installable by adding it to `WEAPON_CONFIGS` and listing it here.
 */
function weaponModule(
  weaponId: string,
  cost: Partial<Record<ResourceKind, number>>,
  requiredWorkshopLevel: number,
  reserveAmmo: number,
): EquipmentModuleDefinition {
  const weapon = WEAPON_CONFIGS[weaponId];
  if (!weapon) {
    throw new Error(`weapon module references unknown weapon "${weaponId}"`);
  }
  return {
    id: weapon.id,
    displayName: weapon.displayName,
    shortName: weapon.shortName,
    color: '#d0613f',
    slotKind: 'weapon',
    weaponId: weapon.id,
    reserveAmmo,
    cost,
    requiredWorkshopLevel,
  };
}

export const EQUIPMENT_MODULES: Readonly<Record<string, EquipmentModuleDefinition>> = {
  [MACHINE_GUN.id]: weaponModule(MACHINE_GUN.id, { scrap: 25 }, 0, 192),
  [CANNON.id]: weaponModule(CANNON.id, { scrap: 60, fuel: 10 }, 1, 24),
  [FLAK_GUN.id]: weaponModule(FLAK_GUN.id, { scrap: 45, fuel: 6 }, 1, 48),
  'reinforced-plating': {
    id: 'reinforced-plating',
    displayName: 'Усиленная броня',
    shortName: 'БРОН',
    color: '#8f9aa6',
    slotKind: 'utility',
    modifiers: { armor: 45 },
    cost: { scrap: 35 },
    requiredWorkshopLevel: 0,
  },
  'cargo-expander': {
    id: 'cargo-expander',
    displayName: 'Расширенный кузов',
    shortName: 'КУЗОВ',
    color: '#b9a27a',
    slotKind: 'utility',
    modifiers: { cargoCapacity: 60 },
    cost: { scrap: 40 },
    requiredWorkshopLevel: 1,
  },
  'salvage-rig': {
    id: 'salvage-rig',
    displayName: 'Добывающая оснастка',
    shortName: 'ДОБЫЧА',
    color: '#d5a535',
    slotKind: 'utility',
    modifiers: { harvestBonus: 7 },
    cost: { scrap: 30, water: 6 },
    requiredWorkshopLevel: 1,
  },
};

export const EQUIPMENT_MODULE_IDS: readonly string[] = Object.keys(EQUIPMENT_MODULES);

export function equipmentModule(id: string): EquipmentModuleDefinition | null {
  return EQUIPMENT_MODULES[id] ?? null;
}

export function weaponConfigForModule(moduleId: string): WeaponConfig | null {
  const module = equipmentModule(moduleId);
  if (!module?.weaponId) return null;
  return WEAPON_CONFIGS[module.weaponId] ?? null;
}

/** Progression track kinds; levels start at 0. */
export type UpgradeTrack = 'engine' | 'chassis' | 'workshop';

export interface UpgradeLevelDefinition {
  readonly level: number;
  readonly displayName: string;
  /** Cargo cost to reach this level from the previous one. */
  readonly cost: Partial<Record<ResourceKind, number>>;
  /** Stat deltas granted on top of every lower level. */
  readonly modifiers: VehicleStatModifier;
}

export const UPGRADE_TRACKS: Readonly<Record<UpgradeTrack, readonly UpgradeLevelDefinition[]>> = {
  engine: [
    { level: 1, displayName: 'Форсированный двигатель', cost: { scrap: 45, fuel: 8 }, modifiers: { maxForwardSpeed: 2.5, engineAcceleration: 2 } },
    { level: 2, displayName: 'Турбонаддув', cost: { scrap: 80, fuel: 20 }, modifiers: { maxForwardSpeed: 2.5, engineAcceleration: 2.5 } },
    { level: 3, displayName: 'Гоночный блок', cost: { scrap: 140, fuel: 35 }, modifiers: { maxForwardSpeed: 3, engineAcceleration: 3 } },
  ],
  chassis: [
    { level: 1, displayName: 'Клёпаная броня', cost: { scrap: 40 }, modifiers: { armor: 40 } },
    { level: 2, displayName: 'Композитные плиты', cost: { scrap: 70, water: 10 }, modifiers: { armor: 50, cargoCapacity: 20 } },
    { level: 3, displayName: 'Реактивная броня', cost: { scrap: 120, fuel: 25 }, modifiers: { armor: 70, cargoCapacity: 30 } },
  ],
  workshop: [
    { level: 1, displayName: 'Верстак', cost: { scrap: 50 }, modifiers: {} },
    { level: 2, displayName: 'Обрабатывающий цех', cost: { scrap: 90, fuel: 15 }, modifiers: {} },
    { level: 3, displayName: 'Ремонтный док', cost: { scrap: 150, fuel: 30, water: 20 }, modifiers: {} },
  ],
};

export const UPGRADE_TRACK_KINDS: readonly UpgradeTrack[] = ['engine', 'chassis', 'workshop'];

export const MAX_UPGRADE_LEVEL = Math.max(
  ...UPGRADE_TRACK_KINDS.map((track) => UPGRADE_TRACKS[track].length),
);

export interface GarageConfig {
  /** How close the vehicle must be to a base to open the garage. */
  readonly reach: number;
  /** Workshop level needed to open the garage at all (0 = any base). */
  readonly requiredWorkshopLevel: number;
  /**
   * Structure the base must have built before it can service the vehicle.
   * Null disables the physical requirement (useful for tests).
   */
  readonly serviceStructure: StructureKind | null;
  /** Utility modifiers are capped so stacked modules cannot break the game. */
  readonly maxCargoCapacity: number;
  readonly maxArmor: number;
  readonly maxHarvestBonus: number;
  readonly maxRadarBonus: number;
}

export const GARAGE_CONFIG: GarageConfig = {
  reach: 6,
  requiredWorkshopLevel: 0,
  serviceStructure: 'workshop',
  maxCargoCapacity: 320,
  maxArmor: 400,
  maxHarvestBonus: 40,
  maxRadarBonus: 120,
};

/** Additive base stats the vehicle is built from. */
export interface VehicleBaseStats {
  /** Absolute armour plating, added on top of the hull hit points. */
  readonly armor: number;
  /** Absolute trunk capacity, in cargo units. */
  readonly cargoCapacity: number;
  /** Extra harvest units per second on top of the inventory base rate. */
  readonly harvestBonus: number;
  /** Extra radar range on top of the sensor base radius. */
  readonly radarBonus: number;
}

export function emptyModifiers(): VehicleStatModifier {
  return {};
}

/** Sums modifiers from several sources into one record. */
export function sumModifiers(
  sources: readonly VehicleStatModifier[],
): VehicleStatModifier {
  const total: Record<string, number> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      total[key] = (total[key] ?? 0) + value;
    }
  }
  return total as VehicleStatModifier;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateEquipmentSlots(
  slots: readonly EquipmentSlotDefinition[],
): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (slots.length === 0) errors.push('at least one equipment slot is required');

  for (const slot of slots) {
    if (slot.id.trim().length === 0) errors.push('slot id must be a non-empty string');
    if (ids.has(slot.id)) errors.push(`duplicate slot id "${slot.id}"`);
    ids.add(slot.id);
    if (slot.displayName.trim().length === 0) {
      errors.push(`slot ${slot.id} displayName must be a non-empty string`);
    }
    if (slot.kind !== 'weapon' && slot.kind !== 'utility') {
      errors.push(`slot ${slot.id} has unknown kind "${String(slot.kind)}"`);
    }
  }

  if (!slots.some((slot) => slot.kind === 'weapon')) {
    errors.push('at least one weapon slot is required');
  }

  return errors;
}

export function validateEquipmentModule(
  module: EquipmentModuleDefinition,
): readonly string[] {
  const errors: string[] = [];

  if (module.id.trim().length === 0) errors.push('module id must be a non-empty string');
  if (module.displayName.trim().length === 0) {
    errors.push(`${module.id}.displayName must be a non-empty string`);
  }
  if (module.shortName.trim().length === 0) {
    errors.push(`${module.id}.shortName must be a non-empty string`);
  }
  if (module.slotKind !== 'weapon' && module.slotKind !== 'utility') {
    errors.push(`${module.id}.slotKind is unknown`);
  }
  if (module.slotKind === 'weapon' && !module.weaponId) {
    errors.push(`${module.id}: weapon modules must name a weapon`);
  }
  if (module.weaponId && !WEAPON_CONFIGS[module.weaponId]) {
    errors.push(`${module.id}: unknown weapon "${module.weaponId}"`);
  }
  if (module.slotKind === 'weapon') {
    if (!Number.isInteger(module.reserveAmmo) || (module.reserveAmmo ?? -1) < 0) {
      errors.push(`${module.id}.reserveAmmo must be a non-negative integer`);
    }
  }
  if (module.slotKind === 'utility' && !module.modifiers) {
    errors.push(`${module.id}: utility modules must declare modifiers`);
  }
  if (module.modifiers) {
    for (const [key, value] of Object.entries(module.modifiers)) {
      if (!isFiniteNumber(value)) {
        errors.push(`${module.id}.modifiers.${key} must be a finite number`);
      }
    }
  }
  if (
    !Number.isInteger(module.requiredWorkshopLevel) ||
    module.requiredWorkshopLevel < 0
  ) {
    errors.push(`${module.id}.requiredWorkshopLevel must be a non-negative integer`);
  }
  if (Object.values(module.cost).every((amount) => (amount ?? 0) <= 0)) {
    errors.push(`${module.id}.cost must cost at least one resource`);
  }

  return errors;
}

export function validateUpgradeTracks(
  tracks: Readonly<Record<UpgradeTrack, readonly UpgradeLevelDefinition[]>>,
): readonly string[] {
  const errors: string[] = [];

  for (const track of UPGRADE_TRACK_KINDS) {
    const levels = tracks[track];
    if (levels.length === 0) {
      errors.push(`track ${track} must have at least one level`);
      continue;
    }
    levels.forEach((entry, index) => {
      const expected = index + 1;
      if (entry.level !== expected) {
        errors.push(`track ${track} level ${expected} is out of order`);
      }
      if (entry.displayName.trim().length === 0) {
        errors.push(`track ${track} level ${expected} needs a displayName`);
      }
      if (Object.values(entry.cost).every((amount) => (amount ?? 0) <= 0)) {
        errors.push(`track ${track} level ${expected} must cost at least one resource`);
      }
      for (const [key, value] of Object.entries(entry.modifiers)) {
        if (!isFiniteNumber(value)) {
          errors.push(`track ${track} level ${expected} modifier ${key} is not finite`);
        }
      }
    });
  }

  return errors;
}

export function validateGarageConfig(config: GarageConfig): readonly string[] {
  const errors: string[] = [];

  if (!isFiniteNumber(config.reach) || config.reach <= 0) {
    errors.push('reach must be a finite positive number');
  }
  if (
    !Number.isInteger(config.requiredWorkshopLevel) ||
    config.requiredWorkshopLevel < 0
  ) {
    errors.push('requiredWorkshopLevel must be a non-negative integer');
  }
  for (const [name, value] of [
    ['maxCargoCapacity', config.maxCargoCapacity],
    ['maxArmor', config.maxArmor],
    ['maxHarvestBonus', config.maxHarvestBonus],
    ['maxRadarBonus', config.maxRadarBonus],
  ] as const) {
    if (!isFiniteNumber(value) || value <= 0) {
      errors.push(`${name} must be a finite positive number`);
    }
  }

  return errors;
}

for (const module of Object.values(EQUIPMENT_MODULES)) {
  const errors = validateEquipmentModule(module);
  if (errors.length > 0) {
    throw new Error(`Invalid equipment module "${module.id}": ${errors.join('; ')}`);
  }
}
