/**
 * Serializable game state.
 *
 * This module belongs to the simulation layer: it contains plain data only,
 * no IndexedDB, no DOM and no Babylon.js. The browser adapter in
 * `src/platform/storage` is responsible for storing a `SaveFile`.
 *
 * Version 2 adds the module locker, resource depletion, RNG state and enemy AI
 * timers. Version 1 saves are migrated on load.
 */

import type { GameplayConfig } from '../../data/gameplay';
import type { UpgradeTrack } from '../../data/garage';
import type { ResourceAmounts } from '../economy/EconomyState';
import type { StructureKind } from '../../data/bases';
import type { RaidReport } from '../raid/RaidState';
import type { RemoteReport } from '../systems/RemoteSimulationSystem';

export const SAVE_SCHEMA_VERSION = 2;

/** Minimum and maximum number of save slots offered in the menu. */
export const SAVE_SLOT_MIN = 1;
export const SAVE_SLOT_MAX = 3;

export interface SerializedVehicleState {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  /** Velocity is part of the physics state; dropping it breaks determinism. */
  readonly vx: number;
  readonly vy: number;
  readonly health: number;
  readonly destroyed: boolean;
  readonly respawnRemainingSeconds: number;
}

export interface SerializedGarageSlot {
  readonly slotId: string;
  readonly moduleId: string | null;
  readonly ammoInMagazine: number;
  readonly reserveAmmo: number;
}

export interface SerializedGarageState {
  readonly slots: readonly SerializedGarageSlot[];
  readonly selectedSlot: number;
  readonly levels: Readonly<Record<UpgradeTrack, number>>;
  readonly locker: readonly {
    readonly moduleId: string;
    readonly ammoInMagazine: number;
    readonly reserveAmmo: number;
  }[];
}

export interface SerializedEconomyState {
  readonly cargo: ResourceAmounts;
  /** «Node id → remaining units», authoritative across chunk unloads. */
  readonly depletion: Readonly<Record<string, number>>;
}

export interface SerializedStructureState {
  readonly id: string;
  readonly kind: StructureKind;
  readonly x: number;
  readonly y: number;
  readonly slotIndex: number;
  readonly builtTick: number;
  readonly active: boolean;
  readonly condition: number;
  readonly deficitSeconds: number;
  readonly upkeepProgress: number;
  readonly productionProgress: number;
  readonly producedTotal: number;
  readonly aimAngle: number;
  readonly cooldownSeconds: number;
}

export interface SerializedBaseState {
  readonly id: string;
  readonly siteId: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly storage: ResourceAmounts;
  readonly structures: readonly SerializedStructureState[];
  readonly foundedTick: number;
  readonly scrappedCount: number;
  readonly minesSpent: number;
  readonly captured: boolean;
}

export interface SerializedEnemyState {
  readonly id: string;
  readonly kind: string;
  readonly aiState: string;
  readonly stateSeconds: number;
  readonly bestDistance: number;
  readonly stallSeconds: number;
  readonly patrolAngle: number;
  readonly aimAngle: number;
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly alive: boolean;
  readonly respawnRemainingSeconds: number;
  readonly fireCooldownSeconds: number;
}

export interface SerializedRaidState {
  readonly id: string;
  readonly baseId: string;
  readonly baseName: string;
  readonly phase: string;
  readonly secondsRemaining: number;
  readonly attackers: number;
  readonly attackerIds: readonly string[];
  readonly looted: number;
  readonly damagedStructures: number;
}

export interface SerializedGameState {
  /** The whole data-driven config is saved so a slot is self-contained. */
  readonly config: GameplayConfig;
  readonly tick: number;
  readonly rngState: number;
  readonly vehicle: SerializedVehicleState;
  readonly garage: SerializedGarageState;
  readonly economy: SerializedEconomyState;
  readonly bases: {
    readonly selectedBaseIndex: number;
    readonly items: readonly SerializedBaseState[];
    readonly raidCooldownSeconds: number;
    readonly nextRaidId: number;
    readonly raids: readonly SerializedRaidState[];
    readonly reports: readonly RaidReport[];
  };
  readonly enemies: readonly SerializedEnemyState[];
  readonly remote: {
    readonly accumulator: number;
    readonly ticks: number;
    readonly reports: readonly RemoteReport[];
    readonly nextReportId: number;
  };
}

/** Envelope stored in a slot. `savedAt` is metadata, never used by the sim. */
export interface SaveFile {
  readonly schemaVersion: number;
  readonly savedAt: number;
  readonly game: SerializedGameState;
}

/** Compact slot description shown in the menu. */
export interface SaveSlotInfo {
  readonly slot: number;
  readonly savedAt: number | null;
  readonly tick: number | null;
  readonly label: string;
}
