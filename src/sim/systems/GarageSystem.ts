import {
  EQUIPMENT_MODULES,
  EQUIPMENT_MODULE_IDS,
  EQUIPMENT_SLOTS,
  GARAGE_CONFIG,
  UPGRADE_TRACK_KINDS,
  type GarageConfig,
  type UpgradeTrack,
} from '../../data/garage';
import { BASE_CONFIG, costEntries, type StructureKind } from '../../data/bases';
import { RESOURCE_DEFINITIONS, type ResourceKind } from '../../data/resources';
import { baseAt, type BaseState } from '../base/BaseState';
import {
  baseHasServiceStructure,
  describeUpgrade,
  garageSlotKind,
  installModule,
  removeModule,
  resolveVehicleStats,
  upgradeLevel,
  workshopLevel,
  type GarageContext,
  type GarageRefusal,
  type GarageState,
} from '../garage/GarageState';
import type { EquipmentAction } from '../input/EquipmentCommand';
import type { GarageInfo, GarageOptionInfo } from '../world/WorldState';
import type { SimulationContext, System } from '../System';

function costLabel(cost: Partial<Record<ResourceKind, number>>): string {
  const label = costEntries(cost)
    .map(({ kind, amount }) => `${amount} ${RESOURCE_DEFINITIONS[kind].shortName}`)
    .join(' + ');
  return label.length > 0 ? label : '—';
}

function affordable(
  cargo: Readonly<Record<ResourceKind, number>>,
  cost: Partial<Record<ResourceKind, number>>,
): boolean {
  return costEntries(cost).every(({ kind, amount }) => cargo[kind] >= amount);
}

/** Localised reason shown next to a refused garage action. */
const REFUSAL_LABELS: Readonly<Record<GarageRefusal, string>> = {
  'no-base': 'НУЖНА БАЗА',
  'no-workshop': 'НУЖНА МАСТЕРСКАЯ',
  'unknown-slot': 'НЕТ СЛОТА',
  'unknown-module': 'НЕТ МОДУЛЯ',
  'wrong-slot-kind': 'НЕ ПОДХОДИТ',
  'workshop-level': 'НУЖЕН УРОВЕНЬ МАСТЕРСКОЙ',
  'not-enough-resources': 'НЕ ХВАТАЕТ РЕСУРСОВ',
  'slot-occupied': 'СЛОТ ЗАНЯТ',
  'slot-empty': 'СЛОТ ПУСТ',
  'locker-missing': 'НЕТ В ХРАНИЛИЩЕ',
  'max-level': 'МАКСИМУМ',
  'unknown-track': 'НЕИЗВЕСТНО',
};

export function refusalLabel(reason: GarageRefusal | null): string | null {
  if (reason === null) return null;
  return REFUSAL_LABELS[reason] ?? null;
}

/**
 * Garage: equipment slots, upgrades and vehicle stat recalculation.
 *
 * The system is idle on ticks without commands, so a parked car costs nothing.
 * Every mutation recomputes the whole derived stat block, which makes an
 * install/remove round-trip exactly reversible.
 */
export class GarageSystem implements System {
  readonly id = 'garage';
  readonly #config: GarageConfig;
  readonly #serviceStructure: StructureKind | null;

  constructor(config: GarageConfig = GARAGE_CONFIG) {
    this.#config = config;
    this.#serviceStructure = config.serviceStructure;
  }

  update(context: SimulationContext, _deltaSeconds: number): void {
    const world = context.world;
    const garage = world.garage;
    const base = this.#serviceBase(context);
    const garageContext: GarageContext = {
      atBase: base !== null,
      hasWorkshop:
        base !== null && baseHasServiceStructure(base.structures, this.#serviceStructure),
      cargo: world.economy.cargo,
    };

    for (const action of world.equipmentActions) {
      this.#apply(garage, garageContext, action);
    }
    world.equipmentActions = [];

    // Recompute once after the whole batch so the movement system and the HUD
    // see one consistent stat block however many actions arrived together.
    const stats = resolveVehicleStats(context.config.vehicle, garage, this.#config);
    garage.stats = stats;
    this.#applyHealthCeiling(context, stats.maxHealth);

    world.garageInfo = this.#describe(garage, garageContext, stats.maxHealth);
  }

  /** Base whose garage the vehicle is parked at, if any. */
  #serviceBase(context: SimulationContext): BaseState | null {
    const { x, y } = context.world.vehicle.position;
    const reach = Math.max(this.#config.reach, BASE_CONFIG.reach);
    return baseAt(context.world.bases, x, y, reach);
  }

  /**
   * Armour raises the health ceiling.
   *
   * Current hit points rise by the same amount, so buying plating is an
   * immediate, visible benefit — but it is not a free repair either.
   */
  #applyHealthCeiling(context: SimulationContext, maxHealth: number): void {
    const world = context.world;
    const delta = maxHealth - world.vehicleMaxHealth;
    if (delta > 0 && !world.vehicleDestroyed) {
      world.vehicleHealth = Math.min(maxHealth, world.vehicleHealth + delta);
    }
    world.vehicleMaxHealth = maxHealth;
    if (world.vehicleHealth > maxHealth) world.vehicleHealth = maxHealth;
  }

  #apply(
    garage: GarageState,
    garageContext: GarageContext,
    action: EquipmentAction,
  ): void {
    switch (action.kind) {
      case 'select-slot': {
        const count = garage.slots.length;
        if (count === 0) return;
        garage.selectedSlot = Math.min(count - 1, Math.max(0, action.index));
        return;
      }
      case 'install': {
        const slot = garage.slots[garage.selectedSlot];
        if (!slot) return;
        const moduleId = action.moduleId ?? this.#firstAvailableModule(garage, slot.slotId);
        if (!moduleId) return;
        const result = installModule(
          garage,
          garageContext,
          slot.slotId,
          moduleId,
          this.#config,
        );
        garage.lastRefusal = result.ok ? null : result.reason;
        return;
      }
      case 'remove': {
        const slot = garage.slots[garage.selectedSlot];
        if (!slot) return;
        const result = removeModule(garage, garageContext, slot.slotId, this.#config);
        garage.lastRefusal = result.ok ? null : result.reason;
        return;
      }
      case 'upgrade': {
        const result = upgradeLevel(garage, garageContext, action.track, this.#config);
        garage.lastRefusal = result.ok ? null : result.reason;
        return;
      }
      default:
        return;
    }
  }

  /** First module of the slot's kind that the workshop level allows. */
  #firstAvailableModule(garage: GarageState, slotId: string): string | null {
    const slotDefinition = EQUIPMENT_SLOTS.find((entry) => entry.id === slotId);
    if (!slotDefinition) return null;

    for (const moduleId of EQUIPMENT_MODULE_IDS) {
      const module = EQUIPMENT_MODULES[moduleId];
      if (!module || module.slotKind !== slotDefinition.kind) continue;
      if (module.requiredWorkshopLevel > workshopLevel(garage)) continue;
      return moduleId;
    }
    return null;
  }

  #describe(
    garage: GarageState,
    garageContext: GarageContext,
    maxHealth: number,
  ): GarageInfo {
    const selectedSlot = garage.slots[garage.selectedSlot] ?? null;

    const slots = garage.slots.map((slot) => {
      const definition = EQUIPMENT_SLOTS.find((entry) => entry.id === slot.slotId);
      const module = slot.moduleId ? EQUIPMENT_MODULES[slot.moduleId] : null;
      return {
        slotId: slot.slotId,
        kind: definition?.kind ?? 'utility',
        label: definition?.displayName ?? slot.slotId,
        moduleName: module?.displayName ?? null,
        shortName: module?.shortName ?? '—',
        reserveAmmo: slot.reserveAmmo,
      };
    });

    const installOptions: GarageOptionInfo[] =
      selectedSlot === null
        ? []
        : EQUIPMENT_MODULE_IDS.filter((moduleId) => {
            const module = EQUIPMENT_MODULES[moduleId];
            return (
              module !== undefined &&
              module.slotKind === garageSlotKind(selectedSlot.slotId)
            );
          }).map((moduleId) => {
            const module = EQUIPMENT_MODULES[moduleId];
            const cost = module?.cost ?? {};
            return {
              id: moduleId,
              label: module?.displayName ?? moduleId,
              shortName: module?.shortName ?? moduleId,
              cost: costLabel(cost),
              affordable: affordable(garageContext.cargo, cost),
              installed: selectedSlot.moduleId === moduleId,
            };
          });

    const upgrades = UPGRADE_TRACK_KINDS.map((track: UpgradeTrack) => {
      const verdict = describeUpgrade(garage, garageContext, track, this.#config);
      return {
        track,
        level: garage.levels[track],
        label: verdict.label,
        cost: costLabel(verdict.cost as Partial<Record<ResourceKind, number>>),
        affordable: verdict.ok,
        maxed: verdict.reason === 'max-level',
      };
    });

    const open = garageContext.atBase && garageContext.hasWorkshop;
    const panelLabel = !garageContext.atBase
      ? 'ГАРАЖ: НУЖНА БАЗА'
      : !garageContext.hasWorkshop
        ? 'ГАРАЖ: НУЖНА МАСТЕРСКАЯ'
        : `ГАРАЖ · ${EQUIPMENT_SLOTS[garage.selectedSlot]?.displayName ?? ''}`.trim();

    return {
      open,
      atBase: garageContext.atBase,
      hasWorkshop: garageContext.hasWorkshop,
      selectedSlot: garage.selectedSlot,
      slots,
      installOptions,
      upgrades,
      locker: garage.locker.map((entry) => ({
        moduleId: entry.moduleId,
        label: EQUIPMENT_MODULES[entry.moduleId]?.displayName ?? entry.moduleId,
        reserveAmmo: entry.reserveAmmo,
      })),
      maxHealth,
      panelLabel,
      refusal: refusalLabel(garage.lastRefusal),
    };
  }
}
