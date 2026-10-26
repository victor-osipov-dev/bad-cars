/**
 * Base building data: prepared pads, structure catalogue and placement rules.
 *
 * Structures are paid for from the player's cargo, so hauling from resource
 * nodes is the loop that unlocks a base. Slot positions live here too: placing
 * a structure picks the first free slot, which keeps placement deterministic
 * without a mouse-driven build mode.
 */

import { RESOURCE_KINDS, type ResourceKind } from './resources';

export type StructureKind = 'depot' | 'workshop' | 'turret' | 'generator' | 'mine';

export interface StructureDefinition {
  readonly displayName: string;
  readonly shortName: string;
  /** HUD / sprite tint. */
  readonly color: string;
  readonly width: number;
  readonly height: number;
  /** Cargo cost, per resource kind (missing kinds cost nothing). */
  readonly cost: Partial<Record<ResourceKind, number>>;
  readonly limitPerBase: number;
}

export const STRUCTURE_DEFINITIONS: Readonly<Record<StructureKind, StructureDefinition>> = {
  depot: {
    displayName: 'Склад',
    shortName: 'СКЛ',
    color: '#b9a27a',
    width: 2.2,
    height: 2,
    cost: { scrap: 20 },
    limitPerBase: 1,
  },
  workshop: {
    displayName: 'Мастерская',
    shortName: 'МАС',
    color: '#7fa9c9',
    width: 2.4,
    height: 2,
    cost: { scrap: 40, water: 5 },
    limitPerBase: 1,
  },
  turret: {
    displayName: 'Турель',
    shortName: 'ТУР',
    color: '#d0613f',
    width: 1.6,
    height: 1.6,
    cost: { scrap: 55, fuel: 8 },
    limitPerBase: 2,
  },
  mine: {
    displayName: 'Мина',
    shortName: 'МИН',
    color: '#c9553a',
    width: 1.3,
    height: 1.3,
    cost: { scrap: 15 },
    limitPerBase: 3,
  },
  generator: {
    displayName: 'Генератор',
    shortName: 'ГЕН',
    color: '#d5a535',
    width: 2,
    height: 2,
    cost: { scrap: 70, fuel: 12 },
    limitPerBase: 1,
  },
};

export const STRUCTURE_KINDS: readonly StructureKind[] = [
  'depot',
  'workshop',
  'turret',
  'generator',
  'mine',
];

export interface BaseConfig {
  /** Cost to found a base on a prepared pad. */
  readonly foundingCost: Partial<Record<ResourceKind, number>>;
  /** How close the vehicle must be to a pad to found or build. */
  readonly reach: number;
  /** Hard cap per base regardless of per-kind limits. */
  readonly maxStructuresPerBase: number;
  /** Minimum gap between two structure footprints, world units. */
  readonly structureGap: number;
  /** Prepared pads generated per chunk, as a chance. */
  readonly siteChance: number;
}

export const BASE_CONFIG: BaseConfig = {
  foundingCost: { scrap: 15 },
  reach: 6,
  maxStructuresPerBase: 6,
  structureGap: 0.3,
  siteChance: 0.16,
};

/**
 * Fixed slot layout on a pad (local offsets from its centre).
 *
 * Deterministic ordering means "first free slot" is reproducible, and tests
 * can predict exactly where a structure lands.
 */
export const BASE_SLOTS: readonly { readonly x: number; readonly y: number }[] = [
  { x: -1.3, y: 1.35 },
  { x: 1.3, y: 1.35 },
  { x: -1.3, y: 0 },
  { x: 1.3, y: 0 },
  { x: -1.3, y: -1.35 },
  { x: 1.3, y: -1.35 },
];

export function structureCost(kind: StructureKind): Partial<Record<ResourceKind, number>> {
  return STRUCTURE_DEFINITIONS[kind].cost;
}

export function costEntries(
  cost: Partial<Record<ResourceKind, number>>,
): readonly { readonly kind: ResourceKind; readonly amount: number }[] {
  return RESOURCE_KINDS.flatMap((kind) => {
    const amount = cost[kind] ?? 0;
    return amount > 0 ? [{ kind, amount }] : [];
  });
}

export function validateBaseConfig(config: BaseConfig): readonly string[] {
  const errors: string[] = [];

  if (!Number.isFinite(config.reach) || config.reach <= 0) {
    errors.push('reach must be a finite positive number');
  }
  if (
    !Number.isInteger(config.maxStructuresPerBase) ||
    config.maxStructuresPerBase < 1
  ) {
    errors.push('maxStructuresPerBase must be a positive integer');
  }
  if (config.maxStructuresPerBase > BASE_SLOTS.length) {
    errors.push('maxStructuresPerBase cannot exceed the number of slots');
  }
  if (!Number.isFinite(config.structureGap) || config.structureGap < 0) {
    errors.push('structureGap must be a finite non-negative number');
  }
  if (!Number.isFinite(config.siteChance) || config.siteChance < 0 || config.siteChance > 1) {
    errors.push('siteChance must be in [0, 1]');
  }
  if (costEntries(config.foundingCost).length === 0) {
    errors.push('foundingCost must cost at least one resource');
  }

  return errors;
}

export function validateStructureDefinitions(
  definitions: Readonly<Record<string, StructureDefinition>>,
): readonly string[] {
  const errors: string[] = [];

  for (const [kind, definition] of Object.entries(definitions)) {
    if (definition.displayName.trim().length === 0) {
      errors.push(`${kind}.displayName must be a non-empty string`);
    }
    if (!Number.isFinite(definition.width) || definition.width <= 0) {
      errors.push(`${kind}.width must be a finite positive number`);
    }
    if (!Number.isFinite(definition.height) || definition.height <= 0) {
      errors.push(`${kind}.height must be a finite positive number`);
    }
    if (!Number.isInteger(definition.limitPerBase) || definition.limitPerBase < 1) {
      errors.push(`${kind}.limitPerBase must be a positive integer`);
    }
    if (costEntries(definition.cost).length === 0) {
      errors.push(`${kind}.cost must cost at least one resource`);
    }
  }

  return errors;
}
