/**
 * Base economy: upkeep and production per structure.
 *
 * Rates are per minute so balance numbers stay readable; the simulation
 * converts them to per-second rates internally. A structure whose upkeep
 * cannot be paid goes inactive and starts degrading — that is the pressure
 * that makes hauling matter.
 */

import type { StructureKind } from './bases';
import type { ResourceKind } from './resources';

export interface StructureEconomy {
  /** Resources dragged from the base depot every minute. */
  readonly upkeep: Partial<Record<ResourceKind, number>>;
  /** Resources added to the base depot every minute. */
  readonly production: Partial<Record<ResourceKind, number>>;
}

export const STRUCTURE_ECONOMY: Readonly<Record<StructureKind, StructureEconomy>> = {
  depot: {
    upkeep: { scrap: 0.5 },
    production: {},
  },
  workshop: {
    // Processes scrap into usable stock: net +1 scrap per minute.
    upkeep: { scrap: 1, water: 0.5 },
    production: { scrap: 2 },
  },
  turret: {
    // Defence costs fuel and produces nothing.
    upkeep: { fuel: 1.5 },
    production: {},
  },
  mine: {
    // Ordnance needs no upkeep, but it is consumed when it detonates.
    upkeep: {},
    production: {},
  },
  generator: {
    // Burns fuel to make more fuel than it consumes.
    upkeep: { fuel: 1 },
    production: { fuel: 3 },
  },
};

export interface EconomyConfig {
  /** Condition points a structure has before it is scrapped. */
  readonly maxCondition: number;
  /** Seconds of unpaid upkeep per lost condition point. */
  readonly degradationSeconds: number;
  /** Seconds of unpaid upkeep before degradation starts. */
  readonly graceSeconds: number;
}

export const ECONOMY_CONFIG: EconomyConfig = {
  maxCondition: 3,
  degradationSeconds: 30,
  graceSeconds: 20,
};

export function validateEconomyConfig(config: EconomyConfig): readonly string[] {
  const errors: string[] = [];

  if (!Number.isInteger(config.maxCondition) || config.maxCondition < 1) {
    errors.push('maxCondition must be a positive integer');
  }
  if (!Number.isFinite(config.degradationSeconds) || config.degradationSeconds <= 0) {
    errors.push('degradationSeconds must be a finite positive number');
  }
  if (!Number.isFinite(config.graceSeconds) || config.graceSeconds < 0) {
    errors.push('graceSeconds must be a finite non-negative number');
  }

  return errors;
}

export function validateStructureEconomy(
  economy: Readonly<Record<string, StructureEconomy>>,
): readonly string[] {
  const errors: string[] = [];

  for (const [kind, entry] of Object.entries(economy)) {
    for (const [field, rates] of [
      ['upkeep', entry.upkeep],
      ['production', entry.production],
    ] as const) {
      for (const [resource, rate] of Object.entries(rates)) {
        if (!Number.isFinite(rate) || rate < 0) {
          errors.push(`${kind}.${field}.${resource} must be a finite non-negative number`);
        }
      }
    }
  }

  return errors;
}

/** True when the structure consumes nothing and can never go inactive. */
export function isSelfSufficient(economy: StructureEconomy): boolean {
  return Object.values(economy.upkeep).every((rate) => (rate ?? 0) === 0);
}
