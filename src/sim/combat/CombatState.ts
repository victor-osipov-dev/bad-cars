import type { Vec2 } from '../../core/math/Vec2';
import type { EnemyKind } from '../../data/enemies';
import type { EffectKind } from '../../data/effects';
import type { ProjectileKind } from '../../data/weapons';

export interface WeaponSlotState {
  readonly weaponId: string;
  ammoInMagazine: number;
  reserveAmmo: number;
  /** Seconds until the next shot is allowed. */
  cooldownSeconds: number;
  /** Seconds left in the current reload; 0 when not reloading. */
  reloadRemainingSeconds: number;
}

export interface CombatState {
  activeSlot: number;
  /** Resolved turret angle, radians CCW from +X. */
  aimAngle: number;
  /** World-space aim point when the player is aiming; null means follow heading. */
  aimPoint: Vec2 | null;
  /** Last consumed reload request token. */
  lastReloadToken: number;
  weapons: WeaponSlotState[];
}

export interface EnemyState {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly spawnX: number;
  readonly spawnY: number;
  /** Turret angle; enemies with weapons rotate toward the player. */
  rotation: number;
  readonly radius: number;
  readonly maxHealth: number;
  position: Vec2;
  health: number;
  alive: boolean;
  respawnRemainingSeconds: number;
  /** Seconds until this enemy may fire again. */
  fireCooldownSeconds: number;
}

export type ProjectileOwner = 'player' | 'enemy';

export interface ProjectileState {
  readonly id: number;
  readonly weaponId: string;
  /** Who fired it; enemy rounds damage the player, player rounds enemies. */
  readonly owner: ProjectileOwner;
  readonly kind: ProjectileKind;
  position: Vec2;
  readonly velocity: Vec2;
  readonly damage: number;
  readonly radius: number;
  ageSeconds: number;
  readonly lifetimeSeconds: number;
}

export interface EffectState {
  readonly id: number;
  readonly kind: EffectKind;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  ageSeconds: number;
  readonly lifetimeSeconds: number;
}
