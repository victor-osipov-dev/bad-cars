import type { StructureKind } from '../../data/bases';
import {
  ECONOMY_CONFIG,
  STRUCTURE_ECONOMY,
  type EconomyConfig,
} from '../../data/economy';
import { RESOURCE_KINDS, type ResourceKind } from '../../data/resources';
import type { BaseState, StructureState } from '../base/BaseState';
import type { ResourceAmounts } from '../economy/EconomyState';
import type { SimulationContext, System } from '../System';

/** Upkeep/production of a base, expressed per minute for the HUD. */
export interface BaseEconomyRates {
  readonly upkeepPerMinute: Partial<Record<ResourceKind, number>>;
  readonly productionPerMinute: Partial<Record<ResourceKind, number>>;
  readonly netPerMinute: Partial<Record<ResourceKind, number>>;
  readonly inactiveStructures: number;
}

function addRates(
  target: Record<string, number>,
  source: Partial<Record<ResourceKind, number>>,
): void {
  for (const kind of RESOURCE_KINDS) {
    const rate = source[kind] ?? 0;
    if (rate === 0) continue;
    target[kind] = (target[kind] ?? 0) + rate;
  }
}

export function baseEconomyRates(base: BaseState): BaseEconomyRates {
  const upkeep: Record<string, number> = {};
  const production: Record<string, number> = {};
  let inactiveStructures = 0;

  for (const structure of base.structures) {
    if (!structure.active) inactiveStructures += 1;
    const economy = STRUCTURE_ECONOMY[structure.kind];
    addRates(upkeep, economy.upkeep);
    // Inactive structures produce nothing, but still owe upkeep.
    if (structure.active) addRates(production, economy.production);
  }

  const net: Record<string, number> = { ...production };
  for (const [kind, rate] of Object.entries(upkeep)) {
    net[kind] = (net[kind] ?? 0) - rate;
  }

  return {
    upkeepPerMinute: upkeep,
    productionPerMinute: production,
    netPerMinute: net,
    inactiveStructures,
  };
}

/**
 * Base upkeep, production and deficit consequences.
 *
 * Every tick each structure accumulates its per-minute upkeep scaled to the
 * fixed step and pays whole units out of the base depot. If a payment cannot
 * be made the structure goes inactive (no production), a deficit timer starts,
 * and after the grace period it loses condition until it is scrapped. All
 * arithmetic is fixed-step and integer-transfer based, so long runs stay
 * deterministic and storage never goes negative.
 */
export class EconomySystem implements System {
  readonly id = 'economy';
  readonly #config: EconomyConfig;
  /** Bases closer than this to the player are simulated every tick. */
  readonly #localRadius: number;

  constructor(config: EconomyConfig = ECONOMY_CONFIG, localRadius = Infinity) {
    this.#config = config;
    this.#localRadius = localRadius;
  }

  update(context: SimulationContext, deltaSeconds: number): void {
    const { x, y } = context.world.vehicle.position;
    for (const base of context.world.bases) {
      // Remote bases are advanced by RemoteSimulationSystem in coarse ticks.
      if (Math.hypot(base.x - x, base.y - y) > this.#localRadius) continue;
      this.#runBase(base, deltaSeconds);
    }
  }

  /** Advances a single base by `deltaSeconds`; used by the remote tick too. */
  tickBase(base: BaseState, deltaSeconds: number): void {
    this.#runBase(base, deltaSeconds);
  }

  #runBase(base: BaseState, deltaSeconds: number): void {
    const survivors: StructureState[] = [];

    for (const structure of base.structures) {
      const economy = STRUCTURE_ECONOMY[structure.kind];
      this.#payUpkeep(base, structure, economy.upkeep, deltaSeconds);

      if (structure.active) {
        structure.deficitSeconds = 0;
        this.#produce(base, structure, economy.production, deltaSeconds);
        survivors.push(structure);
        continue;
      }

      structure.deficitSeconds += deltaSeconds;
      this.#degrade(structure, survivors);
    }

    if (survivors.length !== base.structures.length) {
      base.scrappedCount += base.structures.length - survivors.length;
      base.structures = survivors;
    }
  }

  /**
   * Charges upkeep and decides whether the structure can run.
   *
   * A structure needs at least one whole unit of every resource it consumes
   * to be considered supplied. Without that it goes offline immediately
   * instead of running for up to a minute on credit — a base with no fuel
   * should not keep a turret online.
   */
  #payUpkeep(
    base: BaseState,
    structure: StructureState,
    upkeep: Partial<Record<ResourceKind, number>>,
    deltaSeconds: number,
  ): void {
    const supplied = RESOURCE_KINDS.every((kind) => {
      const perMinute = upkeep[kind] ?? 0;
      return perMinute <= 0 || base.storage[kind] >= 1;
    });

    if (!supplied) {
      structure.active = false;
      return;
    }

    structure.active = true;

    for (const kind of RESOURCE_KINDS) {
      const perMinute = upkeep[kind] ?? 0;
      if (perMinute <= 0) continue;

      structure.upkeepProgress += (perMinute / 60) * deltaSeconds;

      while (structure.upkeepProgress >= 1 && base.storage[kind] >= 1) {
        base.storage[kind] -= 1;
        structure.upkeepProgress -= 1;
      }
    }
  }

  #produce(
    base: BaseState,
    structure: StructureState,
    production: Partial<Record<ResourceKind, number>>,
    deltaSeconds: number,
  ): void {
    for (const kind of RESOURCE_KINDS) {
      const perMinute = production[kind] ?? 0;
      if (perMinute <= 0) continue;

      structure.productionProgress += (perMinute / 60) * deltaSeconds;

      while (structure.productionProgress >= 1) {
        structure.productionProgress -= 1;
        base.storage[kind] += 1;
        structure.producedTotal += 1;
      }
    }
  }

  #degrade(structure: StructureState, survivors: StructureState[]): void {
    if (structure.deficitSeconds < this.#config.graceSeconds) {
      survivors.push(structure);
      return;
    }

    const overdue = structure.deficitSeconds - this.#config.graceSeconds;
    const damage = Math.floor(overdue / this.#config.degradationSeconds);
    if (damage <= 0) {
      survivors.push(structure);
      return;
    }

    structure.condition -= damage;
    // Consume the time covered by this damage so the next hit needs another
    // full degradation interval.
    structure.deficitSeconds =
      this.#config.graceSeconds + (overdue % this.#config.degradationSeconds);

    if (structure.condition > 0) survivors.push(structure);
  }
}

export type { ResourceAmounts, StructureKind };
