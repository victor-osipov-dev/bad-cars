import {
  BASE_CONFIG,
  STRUCTURE_DEFINITIONS,
  costEntries,
  type StructureKind,
} from '../../data/bases';
import { RESOURCE_DEFINITIONS, type ResourceKind } from '../../data/resources';
import {
  baseAt,
  payCost,
  slotPosition,
  structureCount,
  unclaimedSiteAt,
  validatePlacement,
  type BaseState,
} from '../base/BaseState';
import { emptyAmounts } from '../economy/EconomyState';
import type { BuildInfo } from '../world/WorldState';
import type { SimulationContext, System } from '../System';

function costLabel(cost: Partial<Record<ResourceKind, number>>): string {
  return costEntries(cost)
    .map(({ kind, amount }) => `${amount} ${RESOURCE_DEFINITIONS[kind].shortName}`)
    .join(' + ');
}

/** First structure kind the base can still accept, or null when full. */
function nextStructure(base: BaseState): StructureKind | null {
  for (const kind of ['depot', 'workshop', 'turret', 'generator'] as const) {
    if (structureCount(base, kind) < STRUCTURE_DEFINITIONS[kind].limitPerBase) {
      return kind;
    }
  }
  return null;
}

/**
 * Base founding and structure placement.
 *
 * Both actions are edge-triggered by monotonic tokens inside the drive
 * command, so holding a key acts once and replaying the same command stream
 * rebuilds the same bases. Costs are paid from the player's cargo.
 */
export class BaseSystem implements System {
  readonly id = 'bases';

  update(context: SimulationContext, _deltaSeconds: number): void {
    const world = context.world;
    const controls = world.controls;
    const { x, y } = world.vehicle.position;
    const reach = BASE_CONFIG.reach;

    const here = baseAt(world.bases, x, y, reach);
    const site = unclaimedSiteAt(world.baseSites, world.bases, x, y, reach);
    world.buildInfo = this.#describe(here, site, world.economy.cargo);

    if (controls.cycleBaseToken !== world.lastCycleBaseToken) {
      world.lastCycleBaseToken = controls.cycleBaseToken;
      if (world.bases.length > 0) {
        world.selectedBaseIndex =
          (world.selectedBaseIndex + 1) % world.bases.length;
      }
    }

    if (controls.foundBaseToken !== world.lastFoundToken) {
      world.lastFoundToken = controls.foundBaseToken;
      if (site) this.#found(context, site.id, site.x, site.y);
    }

    if (controls.buildToken !== world.lastBuildToken) {
      world.lastBuildToken = controls.buildToken;
      if (here) this.#build(context, here);
    }
  }

  #describe(
    here: BaseState | null,
    site: { readonly id: string } | null,
    cargo: SimulationContext['world']['economy']['cargo'],
  ): BuildInfo | null {
    if (site) {
      return {
        action: 'found',
        label: 'B — ОСНОВАТЬ БАЗУ',
        structure: null,
        affordable: true,
        cost: costLabel(BASE_CONFIG.foundingCost),
      };
    }
    if (!here) return null;

    const kind = nextStructure(here);
    if (!kind) return null;
    const definition = STRUCTURE_DEFINITIONS[kind];
    const verdict = validatePlacement(here, kind, cargo);

    return {
      action: 'build',
      label: `V — ПОСТРОИТЬ ${definition.displayName.toUpperCase()}`,
      structure: kind,
      affordable: verdict.ok,
      cost: costLabel(definition.cost),
    };
  }

  #found(context: SimulationContext, siteId: string, x: number, y: number): boolean {
    const world = context.world;
    if (!payCost(world.economy.cargo, BASE_CONFIG.foundingCost)) return false;

    world.bases.push({
      id: `base-${world.bases.length + 1}`,
      siteId,
      name: `База ${world.bases.length + 1}`,
      x,
      y,
      storage: emptyAmounts(),
      structures: [],
      foundedTick: context.time.tick,
    });
    world.selectedBaseIndex = world.bases.length - 1;
    return true;
  }

  #build(context: SimulationContext, base: BaseState): boolean {
    const world = context.world;
    const kind = nextStructure(base);
    if (!kind) return false;

    const verdict = validatePlacement(base, kind, world.economy.cargo);
    if (!verdict.ok) return false;

    const definition = STRUCTURE_DEFINITIONS[kind];
    if (!payCost(world.economy.cargo, definition.cost)) return false;

    const position = slotPosition(base, verdict.slotIndex);
    base.structures.push({
      id: `struct-${base.id}-${base.structures.length + 1}`,
      kind,
      x: position.x,
      y: position.y,
      slotIndex: verdict.slotIndex,
      builtTick: context.time.tick,
    });
    return true;
  }
}
