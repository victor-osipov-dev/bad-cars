import {
  BASE_CONFIG,
  BASE_SLOTS,
  STRUCTURE_DEFINITIONS,
  type StructureKind,
} from '../../data/bases';
import { RESOURCE_KINDS, type ResourceKind } from '../../data/resources';
import type { ResourceAmounts } from '../economy/EconomyState';

export interface StructureState {
  readonly id: string;
  readonly kind: StructureKind;
  /** World position, resolved from the pad centre and a fixed slot. */
  readonly x: number;
  readonly y: number;
  readonly slotIndex: number;
  readonly builtTick: number;
}

export interface BaseState {
  readonly id: string;
  /** Id of the prepared pad this base occupies. */
  readonly siteId: string;
  name: string;
  readonly x: number;
  readonly y: number;
  /** Each base keeps its own depot contents. */
  storage: ResourceAmounts;
  structures: StructureState[];
  readonly foundedTick: number;
}

/** Prepared pad generated with a chunk, plus its claim state. */
export interface BaseSiteState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** True when `cargo` covers every resource in `cost`. */
export function canAfford(
  cargo: Readonly<ResourceAmounts>,
  cost: Partial<Record<ResourceKind, number>>,
): boolean {
  return RESOURCE_KINDS.every((kind) => cargo[kind] >= (cost[kind] ?? 0));
}

/** Subtracts `cost` from `cargo` in place; false (and no change) if short. */
export function payCost(
  cargo: ResourceAmounts,
  cost: Partial<Record<ResourceKind, number>>,
): boolean {
  if (!canAfford(cargo, cost)) return false;
  for (const kind of RESOURCE_KINDS) {
    cargo[kind] -= cost[kind] ?? 0;
  }
  return true;
}

export function storageTotal(base: BaseState): number {
  return base.storage.scrap + base.storage.fuel + base.storage.water;
}

export function structureCount(base: BaseState, kind: StructureKind): number {
  return base.structures.filter((structure) => structure.kind === kind).length;
}

export interface PlacementVerdict {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly slotIndex: number;
}

/**
 * Validates placing `kind` on `base`.
 *
 * Checks, in order: per-base total limit, per-kind limit, funds, and a free
 * slot. Slots are discreet and non-overlapping by construction, so slot
 * occupancy is the overlap test.
 */
export function validatePlacement(
  base: BaseState,
  kind: StructureKind,
  cargo: Readonly<ResourceAmounts>,
): PlacementVerdict {
  const definition = STRUCTURE_DEFINITIONS[kind];

  if (base.structures.length >= BASE_CONFIG.maxStructuresPerBase) {
    return { ok: false, reason: 'НЕТ МЕСТА', slotIndex: -1 };
  }
  if (structureCount(base, kind) >= definition.limitPerBase) {
    return { ok: false, reason: 'ЛИМИТ', slotIndex: -1 };
  }
  if (!canAfford(cargo, definition.cost)) {
    return { ok: false, reason: 'НЕ ХВАТАЕТ РЕСУРСОВ', slotIndex: -1 };
  }

  const usedSlots = new Set(base.structures.map((structure) => structure.slotIndex));
  const slotIndex = BASE_SLOTS.findIndex((_, index) => !usedSlots.has(index));
  if (slotIndex < 0) {
    return { ok: false, reason: 'НЕТ МЕСТА', slotIndex: -1 };
  }

  return { ok: true, reason: null, slotIndex };
}

export function slotPosition(
  base: BaseState,
  slotIndex: number,
): { x: number; y: number } {
  const slot = BASE_SLOTS[slotIndex] ?? BASE_SLOTS[0] ?? { x: 0, y: 0 };
  return { x: base.x + slot.x, y: base.y + slot.y };
}

/** Nearest base within `reach`, or null. */
export function baseAt(
  bases: readonly BaseState[],
  x: number,
  y: number,
  reach: number,
): BaseState | null {
  let best: BaseState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const base of bases) {
    const dx = base.x - x;
    const dy = base.y - y;
    const distance = dx * dx + dy * dy;
    if (distance > reach * reach) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = base;
    }
  }

  return best;
}

/** Nearest prepared pad that no base occupies yet. */
export function unclaimedSiteAt(
  sites: readonly BaseSiteState[],
  bases: readonly BaseState[],
  x: number,
  y: number,
  reach: number,
): BaseSiteState | null {
  const claimed = new Set(bases.map((base) => base.siteId));
  let best: BaseSiteState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const site of sites) {
    if (claimed.has(site.id)) continue;
    const dx = site.x - x;
    const dy = site.y - y;
    const distance = dx * dx + dy * dy;
    if (distance > reach * reach) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = site;
    }
  }

  return best;
}
