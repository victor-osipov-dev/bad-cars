import type { ResourceKind } from '../../data/resources';

/** Live resource node; `remaining` shrinks as the player harvests it. */
export interface ResourceNodeState {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly x: number;
  readonly y: number;
  readonly maxAmount: number;
  remaining: number;
}

export type ResourceAmounts = Record<ResourceKind, number>;

export interface EconomyState {
  /** Trunk contents; limited by `cargoCapacity`. */
  cargo: ResourceAmounts;
  cargoCapacity: number;
  /** Fractional-unit accumulators keep harvest/deposit rates exact. */
  harvestProgress: number;
  depositProgress: number;
  /**
   * Remaining amount per node id.
   *
   * Chunks are regenerated from the seed when the player returns, which would
   * refill a node that was already mined. This map is the authoritative
   * depletion record and is applied whenever chunks (re)enter memory.
   */
  depletion: Record<string, number>;
}

export type InteractionKind = 'harvest' | 'deposit';

export interface InteractionTarget {
  readonly kind: InteractionKind;
  readonly nodeId: string | null;
  readonly label: string;
  readonly resource: ResourceKind | null;
}

export function emptyAmounts(): ResourceAmounts {
  return { scrap: 0, fuel: 0, water: 0 };
}

export function cargoTotal(economy: EconomyState): number {
  return economy.cargo.scrap + economy.cargo.fuel + economy.cargo.water;
}

export function freeCapacity(economy: EconomyState): number {
  return Math.max(0, economy.cargoCapacity - cargoTotal(economy));
}

/**
 * Trims cargo so the total fits `cargoCapacity`.
 *
 * Fitting a smaller trunk (removing a cargo-expander) must not leave the car
 * carrying more than it can hold. Scrap is trimmed first, then fuel, then
 * water, so the most abundant salvage is what gets dumped.
 */
export function clampCargo(economy: EconomyState): void {
  let overflow = cargoTotal(economy) - economy.cargoCapacity;
  if (overflow <= 0) return;
  for (const kind of ['scrap', 'fuel', 'water'] as const) {
    if (overflow <= 0) break;
    const drop = Math.min(economy.cargo[kind], overflow);
    economy.cargo[kind] -= drop;
    overflow -= drop;
  }
}

export function createEconomyState(cargoCapacity: number): EconomyState {
  return {
    cargo: emptyAmounts(),
    cargoCapacity,
    harvestProgress: 0,
    depositProgress: 0,
    depletion: {},
  };
}
