import type { ArenaConfig, PropKind, PropPlacement } from '../../data/gameplay';
import type { EnemyKind } from '../../data/enemies';
import type { EffectKind } from '../../data/effects';
import type { ProjectileKind } from '../../data/weapons';
import type { AimControls } from '../input/AimCommand';
import type { DriveControls } from '../input/DriveCommand';
import type {
  CombatState,
  EffectState,
  EnemyState,
  ProjectileState,
} from '../combat/CombatState';
import type { ResourceKind } from '../../data/resources';
import type {
  BaseSiteState,
  BaseState,
} from '../base/BaseState';
import type {
  EconomyState,
  InteractionTarget,
  ResourceNodeState,
} from '../economy/EconomyState';
import type { RaidReport, RaidState } from '../raid/RaidState';
import type { RemoteReport } from '../systems/RemoteSimulationSystem';
import type { SensorState } from '../systems/SensorSystem';
import type { ChunkCoord, ChunkData } from './chunkGeneration';
import type { ObstacleCircle, VehicleState } from '../vehicle/VehicleState';

export interface ChunkStreamingStats {
  /** Chunks generated over the whole session (monotonic). */
  readonly loadedTotal: number;
  /** Chunks released over the whole session (monotonic). */
  readonly unloadedTotal: number;
  /** Chunks currently resident. */
  readonly active: number;
}

export interface WorldState {
  /** World bounds; the vehicle is clamped to this rectangle. */
  readonly arena: ArenaConfig;
  /** Procedural chunks currently resident around the player. */
  chunks: readonly ChunkData[];
  /** Chunk coordinate the resident set is centred on. */
  streamingCenter: ChunkCoord;
  chunkStats: ChunkStreamingStats;
  props: readonly PropPlacement[];
  obstacles: readonly ObstacleCircle[];
  /** Harvestable nodes from resident chunks (depletion applied). */
  resourceNodes: ResourceNodeState[];
  economy: EconomyState;
  /** What holding the interact key would act on right now, if anything. */
  interaction: InteractionTarget | null;
  /** Founded bases, ordered by founding tick. */
  bases: BaseState[];
  /** Prepared pads from resident chunks. */
  baseSites: BaseSiteState[];
  /** HUD focus for the base list; clamped to `bases` length. */
  selectedBaseIndex: number;
  /** Last consumed founding/build/switch tokens (edge-triggered actions). */
  lastFoundToken: number;
  lastBuildToken: number;
  lastCycleBaseToken: number;
  /** What the build keys would do right now, for the HUD. */
  buildInfo: BuildInfo | null;
  /** Radar contacts and base alarm for the HUD. */
  sensors: SensorState;
  /** Raids currently incoming or in progress. */
  raids: RaidState[];
  /** Recent raid outcomes, newest last. */
  raidReports: RaidReport[];
  /** Seconds until the next raid may be planned. */
  raidCooldownSeconds: number;
  nextRaidId: number;
  /** Fractional seconds accumulated toward the next abstract tick. */
  remoteAccumulator: number;
  /** Abstract ticks applied to remote bases since the world was created. */
  remoteTicks: number;
  /** Recent remote-base events, newest last. */
  remoteReports: RemoteReport[];
  nextRemoteReportId: number;
  vehicle: VehicleState;
  /** Current structural hit points of the player vehicle. */
  vehicleHealth: number;
  /** True while the car is wrecked and waiting to respawn. */
  vehicleDestroyed: boolean;
  /** Seconds left until the wreck respawns; 0 when the car is alive. */
  vehicleRespawnRemainingSeconds: number;
  /** Effective controls for the current tick (from the command queue). */
  controls: DriveControls;
  /** Effective aim/fire state for the current tick. */
  aim: AimControls;
  combat: CombatState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  effects: EffectState[];
  nextProjectileId: number;
  nextEffectId: number;
  nextEnemyId: number;
}

export interface Vec2Snapshot {
  readonly x: number;
  readonly y: number;
}

export interface PropSnapshot {
  readonly id: string;
  readonly kind: PropKind;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
}

export interface VehicleSnapshot extends Vec2Snapshot {
  readonly heading: number;
  readonly width: number;
  readonly height: number;
  readonly speed: number;
  readonly forwardSpeed: number;
  readonly steering: number;
  readonly brake: number;
  readonly handbrake: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly destroyed: boolean;
}

export interface WeaponSlotSnapshot {
  readonly weaponId: string;
  readonly shortName: string;
  readonly ammoInMagazine: number;
  readonly reserveAmmo: number;
  readonly magazineSize: number;
  readonly reloadSeconds: number;
  readonly reloadRemainingSeconds: number;
  readonly reloading: boolean;
}

export interface EnemySnapshot extends Vec2Snapshot {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly radius: number;
  readonly rotation: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly alive: boolean;
}

export interface ProjectileSnapshot extends Vec2Snapshot {
  readonly id: number;
  readonly kind: ProjectileKind;
  readonly angle: number;
}

export interface EffectSnapshot extends Vec2Snapshot {
  readonly id: number;
  readonly kind: EffectKind;
  readonly rotation: number;
  readonly ageSeconds: number;
  readonly lifetimeSeconds: number;
}

export interface ChunkSnapshot {
  readonly key: string;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly size: number;
  readonly biome: string;
}

export interface MinimapSnapshot {
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly chunks: readonly ChunkSnapshot[];
  readonly centerChunk: { readonly x: number; readonly y: number };
}

export interface BuildInfo {
  readonly action: 'found' | 'build';
  readonly label: string;
  readonly structure: string | null;
  readonly affordable: boolean;
  readonly cost: string;
}

export interface StructureSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
  readonly condition: number;
  readonly maxCondition: number;
  /** Turret facing, radians (0 for other structures). */
  readonly aimAngle: number;
}

export interface BaseEconomySnapshot {
  readonly netPerMinute: Readonly<Record<string, number>>;
  readonly upkeepPerMinute: Readonly<Record<string, number>>;
  readonly productionPerMinute: Readonly<Record<string, number>>;
  readonly inactiveStructures: number;
  readonly scrappedTotal: number;
  readonly minesSpent: number;
}

export interface BaseSnapshot {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly structures: readonly StructureSnapshot[];
  readonly storage: Readonly<Record<ResourceKind, number>>;
  readonly selected: boolean;
  readonly captured: boolean;
  readonly economy: BaseEconomySnapshot;
}

export interface RaidSnapshot {
  readonly id: string;
  readonly baseName: string;
  readonly phase: string;
  readonly secondsRemaining: number;
  readonly attackers: number;
  readonly looted: number;
}

export interface RaidReportSnapshot {
  readonly id: string;
  readonly baseName: string;
  readonly outcome: string;
  readonly live: boolean;
  readonly looted: number;
  readonly structuresLost: number;
}

export interface BaseSnapshotGroup {
  readonly bases: readonly BaseSnapshot[];
  readonly build: BuildInfo | null;
  readonly sensors: SensorState;
  readonly raids: readonly RaidSnapshot[];
  readonly reports: readonly RaidReportSnapshot[];
  readonly remote: {
    readonly ticks: number;
    readonly reports: readonly RemoteReport[];
  };
}

export interface ResourceNodeSnapshot {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly x: number;
  readonly y: number;
  readonly remaining: number;
  readonly maxAmount: number;
}

export interface EconomySnapshot {
  readonly cargo: Readonly<Record<ResourceKind, number>>;
  readonly storage: Readonly<Record<ResourceKind, number>>;
  readonly cargoCapacity: number;
  readonly cargoTotal: number;
  readonly storageTotal: number;
  readonly resourceNodes: readonly ResourceNodeSnapshot[];
  readonly interaction: InteractionTarget | null;
}

export interface CombatSnapshot {
  /** Mobile enemies currently chasing or attacking the player. */
  readonly threats: number;
  readonly aimAngle: number;
  readonly aimPoint: Vec2Snapshot | null;
  readonly activeSlot: number;
  readonly weapons: readonly WeaponSlotSnapshot[];
  readonly enemies: readonly EnemySnapshot[];
  readonly projectiles: readonly ProjectileSnapshot[];
  readonly effects: readonly EffectSnapshot[];
}

/**
 * Render-facing, serializable view of the world.
 * The renderer never receives live simulation objects.
 */
export interface WorldSnapshot {
  readonly tick: number;
  readonly elapsedSeconds: number;
  readonly dayIndex: number;
  readonly dayPhase: number;
  readonly hourOfDay: number;
  readonly arena: ArenaConfig;
  readonly vehicle: VehicleSnapshot;
  readonly props: readonly PropSnapshot[];
  readonly minimap: MinimapSnapshot;
  readonly economy: EconomySnapshot;
  readonly baseState: BaseSnapshotGroup;
  readonly chunks: ChunkStreamingStats;
  readonly combat: CombatSnapshot;
}
