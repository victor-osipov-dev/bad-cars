/**
 * Typed gameplay configuration (data-driven design).
 *
 * Values here describe the stage-2 test range. Weapons, buildings, raids and
 * economy configs are added in later stages.
 */

import { ENEMY_SPAWNS, type EnemySpawn } from './enemies';
import { SCRAP_RUNNER, type VehicleConfig } from './vehicles';
import { DEFAULT_LOADOUT, type WeaponSlotConfig } from './weapons';
import { RAID_CONFIG, type RaidConfig } from './raids';
import { REMOTE_CONFIG, type RemoteConfig } from './remote';
import { DEFAULT_WORLD_CONFIG, type WorldConfig } from './worldgen';
import type { ResourceKind } from './resources';

/** Axis-aligned rectangular bounds; the car cannot leave this rectangle. */
export interface ArenaConfig {
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export type PropKind = 'rock' | 'wreck' | 'crate' | 'pad';

export interface PropDefinition {
  readonly width: number;
  readonly height: number;
  /** Solid props block the vehicle; see `ObstacleCircle`. */
  readonly solid: boolean;
}

export const PROP_DEFINITIONS: Readonly<Record<PropKind, PropDefinition>> = {
  rock: { width: 2.2, height: 1.9, solid: true },
  wreck: { width: 3.4, height: 2.0, solid: true },
  crate: { width: 1.1, height: 1.1, solid: true },
  pad: { width: 5.5, height: 4.5, solid: false },
};

export interface PropPlacement {
  readonly id: string;
  readonly kind: PropKind;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
}

/** Handcrafted resource node that is always resident near the spawn. */
export interface ResourceNodeSpawn {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly x: number;
  readonly y: number;
}

export interface GameplayConfig {
  readonly fixedStepHz: number;
  readonly maxSubSteps: number;
  readonly maxFrameDeltaSeconds: number;
  readonly dayLengthSeconds: number;
  readonly worldSeed: number;
  /** Open-world bounds and chunk streaming settings. */
  readonly world: WorldConfig;
  readonly props: readonly PropPlacement[];
  readonly vehicle: VehicleConfig;
  readonly loadout: readonly WeaponSlotConfig[];
  readonly enemySpawns: readonly EnemySpawn[];
  /** Starter nodes around the base; feel free to mine from tick one. */
  readonly spawnResourceNodes: readonly ResourceNodeSpawn[];
  /** Raid timings; tests may compress them. */
  readonly raids: RaidConfig;
  /** Remote-base simulation cadence and caps. */
  readonly remote: RemoteConfig;
}

export const GAME_CONFIG: GameplayConfig = {
  fixedStepHz: 60,
  maxSubSteps: 8,
  maxFrameDeltaSeconds: 0.25,
  dayLengthSeconds: 600,
  worldSeed: 0x5eed_0a11,
  world: DEFAULT_WORLD_CONFIG,
  props: [
    { id: 'rock-nw', kind: 'rock', x: -15.5, y: 6.4, rotation: 0.2, scale: 1.35 },
    { id: 'rock-n', kind: 'rock', x: -9.5, y: 8.6, rotation: 1.1, scale: 1.0 },
    { id: 'rock-ne', kind: 'rock', x: 14.8, y: 7.6, rotation: -0.5, scale: 1.6 },
    { id: 'rock-s', kind: 'rock', x: 2.5, y: -9.2, rotation: 2.2, scale: 1.15 },
    { id: 'rock-se', kind: 'rock', x: 15.4, y: -7.6, rotation: 0.8, scale: 1.0 },
    { id: 'rock-sw', kind: 'rock', x: -16.6, y: -6.2, rotation: -1.4, scale: 1.25 },
    { id: 'rock-far-nw', kind: 'rock', x: -31.2, y: 18.4, rotation: 0.6, scale: 1.5 },
    { id: 'rock-far-ne', kind: 'rock', x: 30.6, y: 19.2, rotation: -0.9, scale: 1.7 },
    { id: 'rock-far-se', kind: 'rock', x: 33.1, y: -18.5, rotation: 1.8, scale: 1.4 },
    { id: 'rock-far-sw', kind: 'rock', x: -33.4, y: -19.1, rotation: -0.2, scale: 1.3 },
    { id: 'wreck-w', kind: 'wreck', x: -10.8, y: -1.2, rotation: 0.45, scale: 1.0 },
    { id: 'wreck-e', kind: 'wreck', x: 11.6, y: -2.4, rotation: -1.05, scale: 1.0 },
    { id: 'wreck-n', kind: 'wreck', x: 0.8, y: 18.1, rotation: 0.15, scale: 1.1 },
    { id: 'wreck-s', kind: 'wreck', x: 6.3, y: -18.4, rotation: -0.7, scale: 1.0 },
    { id: 'crate-a', kind: 'crate', x: 8.1, y: 3.9, rotation: 0.1, scale: 1.0 },
    { id: 'crate-b', kind: 'crate', x: 8.7, y: 5.6, rotation: -0.35, scale: 0.9 },
    { id: 'crate-c', kind: 'crate', x: 9.4, y: 4.4, rotation: 0.7, scale: 0.85 },
    { id: 'crate-d', kind: 'crate', x: -29.8, y: 12.2, rotation: 0.4, scale: 1.0 },
    { id: 'crate-e', kind: 'crate', x: 27.9, y: -8.1, rotation: -0.2, scale: 1.0 },
    { id: 'base-pad-01', kind: 'pad', x: 10.2, y: 5.2, rotation: 0, scale: 1.0 },
  ],
  vehicle: SCRAP_RUNNER,
  loadout: DEFAULT_LOADOUT,
  enemySpawns: ENEMY_SPAWNS,
  raids: RAID_CONFIG,
  remote: REMOTE_CONFIG,
  spawnResourceNodes: [
    { id: 'node-starter-scrap', kind: 'scrap', x: -19.5, y: -12.5 },
    { id: 'node-starter-fuel', kind: 'fuel', x: 14.5, y: 2.5 },
    { id: 'node-starter-water', kind: 'water', x: -6.5, y: -16.5 },
  ],
};
