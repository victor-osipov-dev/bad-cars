import {
  INVENTORY_CONFIG,
  RESOURCE_DEFINITIONS,
  type InventoryConfig,
} from '../../data/resources';
import {
  cargoTotal,
  freeCapacity,
  type InteractionTarget,
  type ResourceNodeState,
} from '../economy/EconomyState';
import type { SimulationContext, System } from '../System';

/**
 * Harvesting and unloading.
 *
 * Transfers happen in whole units gated by a fractional accumulator, so the
 * result is identical for the same tick sequence and total amounts of
 * resources are conserved on every path (node -> cargo -> storage).
 */
export class ResourceSystem implements System {
  readonly id = 'resources';
  readonly #config: InventoryConfig;

  constructor(config: InventoryConfig = INVENTORY_CONFIG) {
    this.#config = config;
  }

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;
    const economy = world.economy;

    const node = this.#nearestNode(context);
    const nearDepot = this.#nearDepot(context);

    // Report what the player could do right now; the HUD renders this.
    world.interaction = this.#describeInteraction(
      node,
      nearDepot,
      cargoTotal(economy),
    );

    if (!world.controls.interact) {
      economy.harvestProgress = 0;
      economy.depositProgress = 0;
      return;
    }

    // Standing on the depot unloads; otherwise harvest the nearest node.
    if (nearDepot && cargoTotal(economy) > 0) {
      this.#deposit(context, deltaSeconds);
      economy.harvestProgress = 0;
      return;
    }

    if (node) {
      this.#harvest(economy, node, deltaSeconds);
    } else {
      economy.harvestProgress = 0;
    }
    economy.depositProgress = 0;
  }

  #nearDepot(context: SimulationContext): boolean {
    const world = context.world;
    const radius =
      context.config.vehicle.collision.radius + this.#config.depositReach;
    const dx = world.vehicle.position.x - world.depot.x;
    const dy = world.vehicle.position.y - world.depot.y;
    return dx * dx + dy * dy <= radius * radius;
  }

  #nearestNode(context: SimulationContext): ResourceNodeState | null {
    const world = context.world;
    const radius =
      context.config.vehicle.collision.radius + this.#config.harvestReach;
    const radiusSquared = radius * radius;

    let best: ResourceNodeState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const node of world.resourceNodes) {
      if (node.remaining <= 0) continue;
      const dx = node.x - world.vehicle.position.x;
      const dy = node.y - world.vehicle.position.y;
      const distance = dx * dx + dy * dy;
      if (distance > radiusSquared) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }

    return best;
  }

  #describeInteraction(
    node: ResourceNodeState | null,
    nearDepot: boolean,
    carried: number,
  ): InteractionTarget | null {
    if (nearDepot && carried > 0) {
      return {
        kind: 'deposit',
        nodeId: null,
        label: 'РАЗГРУЗИТЬ',
        resource: null,
      };
    }
    if (node) {
      return {
        kind: 'harvest',
        nodeId: node.id,
        label: `ДОБЫТЬ ${RESOURCE_DEFINITIONS[node.kind].shortName}`,
        resource: node.kind,
      };
    }
    return null;
  }

  #harvest(
    economy: SimulationContext['world']['economy'],
    node: ResourceNodeState,
    deltaSeconds: number,
  ): void {
    const definition = RESOURCE_DEFINITIONS[node.kind];
    const rate = this.#config.harvestRateUnitsPerSecond * definition.harvestDifficulty;
    economy.harvestProgress += rate * deltaSeconds;

    while (economy.harvestProgress >= 1) {
      const free = freeCapacity(economy);
      // Stop cleanly when either the trunk is full or the node is exhausted;
      // whatever is left stays in the node for a later trip.
      if (free <= 0 || node.remaining <= 0) {
        economy.harvestProgress = 0;
        return;
      }

      economy.harvestProgress -= 1;
      economy.cargo[node.kind] += 1;
      node.remaining -= 1;
      economy.depletion[node.id] = node.remaining;
    }
  }

  #deposit(
    context: SimulationContext,
    deltaSeconds: number,
  ): void {
    const economy = context.world.economy;
    economy.depositProgress += this.#config.depositRateUnitsPerSecond * deltaSeconds;

    while (economy.depositProgress >= 1) {
      const transferred = this.#transferOneUnit(economy);
      if (!transferred) {
        economy.depositProgress = 0;
        return;
      }
      economy.depositProgress -= 1;
    }
  }

  /** Moves one whole unit from cargo to storage; false when cargo is empty. */
  #transferOneUnit(economy: SimulationContext['world']['economy']): boolean {
    for (const kind of ['scrap', 'fuel', 'water'] as const) {
      if (economy.cargo[kind] <= 0) continue;
      economy.cargo[kind] -= 1;
      economy.storage[kind] += 1;
      return true;
    }
    return false;
  }
}
