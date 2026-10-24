/**
 * Resource kinds, inventory rules and interaction tuning.
 *
 * Resources are data: kinds, display colours, harvest difficulty and the cargo
 * capacity all live here so later upgrades (bigger trunk, better tools) can
 * change numbers without touching simulation code.
 */

export type ResourceKind = 'scrap' | 'fuel' | 'water';

export interface ResourceDefinition {
  readonly displayName: string;
  /** Two-letter label used by the compact HUD. */
  readonly shortName: string;
  /** HUD marker colour. */
  readonly color: string;
  /** Multiplier on the base harvest rate; rarer resources dig slower. */
  readonly harvestDifficulty: number;
  /** Amount present in a freshly generated world node. */
  readonly nodeAmount: number;
}

export const RESOURCE_DEFINITIONS: Readonly<Record<ResourceKind, ResourceDefinition>> = {
  scrap: {
    displayName: 'Scrap',
    shortName: 'МЕТ',
    color: '#b9a27a',
    harvestDifficulty: 1,
    nodeAmount: 40,
  },
  fuel: {
    displayName: 'Fuel',
    shortName: 'ТОП',
    color: '#d0613f',
    harvestDifficulty: 0.55,
    nodeAmount: 25,
  },
  water: {
    displayName: 'Water',
    shortName: 'ВОД',
    color: '#6f9ec4',
    harvestDifficulty: 0.7,
    nodeAmount: 30,
  },
};

export const RESOURCE_KINDS: readonly ResourceKind[] = ['scrap', 'fuel', 'water'];

export interface InventoryConfig {
  /** Total cargo units the trunk can hold across all resources. */
  readonly cargoCapacity: number;
  /** Base harvest rate, units per second, before per-resource difficulty. */
  readonly harvestRateUnitsPerSecond: number;
  /** Base deposit rate into storage, units per second. */
  readonly depositRateUnitsPerSecond: number;
  /** Extra reach beyond the vehicle collision radius for harvesting. */
  readonly harvestReach: number;
  /** Extra reach beyond the vehicle collision radius for depositing. */
  readonly depositReach: number;
}

export const INVENTORY_CONFIG: InventoryConfig = {
  cargoCapacity: 120,
  harvestRateUnitsPerSecond: 14,
  depositRateUnitsPerSecond: 90,
  harvestReach: 2.6,
  depositReach: 3.4,
};

export function validateInventoryConfig(config: InventoryConfig): readonly string[] {
  const errors: string[] = [];

  if (!Number.isInteger(config.cargoCapacity) || config.cargoCapacity <= 0) {
    errors.push('cargoCapacity must be a positive integer');
  }
  if (
    !Number.isFinite(config.harvestRateUnitsPerSecond) ||
    config.harvestRateUnitsPerSecond <= 0
  ) {
    errors.push('harvestRateUnitsPerSecond must be a finite positive number');
  }
  if (
    !Number.isFinite(config.depositRateUnitsPerSecond) ||
    config.depositRateUnitsPerSecond <= 0
  ) {
    errors.push('depositRateUnitsPerSecond must be a finite positive number');
  }
  if (!Number.isFinite(config.harvestReach) || config.harvestReach < 0) {
    errors.push('harvestReach must be a finite non-negative number');
  }
  if (!Number.isFinite(config.depositReach) || config.depositReach < 0) {
    errors.push('depositReach must be a finite non-negative number');
  }

  return errors;
}

export function validateResourceDefinitions(
  definitions: Readonly<Record<string, ResourceDefinition>>,
): readonly string[] {
  const errors: string[] = [];

  for (const [kind, definition] of Object.entries(definitions)) {
    if (definition.displayName.trim().length === 0) {
      errors.push(`${kind}.displayName must be a non-empty string`);
    }
    if (definition.shortName.trim().length === 0) {
      errors.push(`${kind}.shortName must be a non-empty string`);
    }
    if (
      !Number.isFinite(definition.harvestDifficulty) ||
      definition.harvestDifficulty <= 0
    ) {
      errors.push(`${kind}.harvestDifficulty must be a finite positive number`);
    }
    if (!Number.isInteger(definition.nodeAmount) || definition.nodeAmount <= 0) {
      errors.push(`${kind}.nodeAmount must be a positive integer`);
    }
  }

  return errors;
}
