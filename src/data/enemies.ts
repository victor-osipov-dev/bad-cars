/** Typed enemy definitions and the fixed target-dummy layout of the range. */

export type EnemyKind = 'scrap-dummy' | 'heavy-dummy';

/** Hostile fire parameters for a turret enemy. */
export interface EnemyWeaponConfig {
  readonly fireIntervalSeconds: number;
  readonly projectileSpeed: number;
  readonly damage: number;
  readonly projectileRadius: number;
  readonly projectileLifetimeSeconds: number;
  /** Maximum distance at which the enemy opens fire, world units. */
  readonly range: number;
  /** Distance from the enemy center to the muzzle, world units. */
  readonly muzzleOffset: number;
  /** Random angular spread (half-width), radians. */
  readonly spreadRadians: number;
  /** Turret turn rate, radians per second. */
  readonly turnRateRadians: number;
}

export interface EnemyDefinition {
  readonly displayName: string;
  readonly maxHealth: number;
  /** Collision/body radius, world units. */
  readonly radius: number;
  /** Seconds after destruction before the dummy is restored. */
  readonly respawnSeconds: number;
  /** Present when the enemy shoots back. */
  readonly weapon?: EnemyWeaponConfig;
}

export const ENEMY_DEFINITIONS: Readonly<Record<EnemyKind, EnemyDefinition>> = {
  'scrap-dummy': {
    displayName: 'Scrap Dummy',
    maxHealth: 60,
    radius: 0.9,
    respawnSeconds: 7,
    weapon: {
      fireIntervalSeconds: 1.6,
      projectileSpeed: 26,
      damage: 4,
      projectileRadius: 0.16,
      projectileLifetimeSeconds: 1.8,
      range: 26,
      muzzleOffset: 1.1,
      spreadRadians: 0.06,
      turnRateRadians: 2.2,
    },
  },
  'heavy-dummy': {
    displayName: 'Heavy Dummy',
    maxHealth: 150,
    radius: 1.2,
    respawnSeconds: 10,
    weapon: {
      fireIntervalSeconds: 2.8,
      projectileSpeed: 22,
      damage: 11,
      projectileRadius: 0.26,
      projectileLifetimeSeconds: 2.2,
      range: 30,
      muzzleOffset: 1.4,
      spreadRadians: 0.035,
      turnRateRadians: 1.3,
    },
  },
};

export interface EnemySpawn {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly x: number;
  readonly y: number;
  /** Sprite rotation, radians. */
  readonly rotation: number;
}

export const ENEMY_SPAWNS: readonly EnemySpawn[] = [
  { id: 'dummy-east', kind: 'scrap-dummy', x: 18, y: 6.5, rotation: 0.2 },
  { id: 'dummy-north', kind: 'scrap-dummy', x: -4, y: 17, rotation: -1.2 },
  { id: 'dummy-south', kind: 'heavy-dummy', x: 29, y: -15, rotation: 2.4 },
  { id: 'dummy-west', kind: 'scrap-dummy', x: -28, y: 12.5, rotation: 1.1 },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateEnemyDefinition(
  definition: EnemyDefinition,
): readonly string[] {
  const errors: string[] = [];
  if (definition.displayName.trim().length === 0) {
    errors.push('displayName must be a non-empty string');
  }
  if (!isFiniteNumber(definition.maxHealth) || definition.maxHealth <= 0) {
    errors.push('maxHealth must be a finite positive number');
  }
  if (!isFiniteNumber(definition.radius) || definition.radius <= 0) {
    errors.push('radius must be a finite positive number');
  }
  if (!isFiniteNumber(definition.respawnSeconds) || definition.respawnSeconds < 0) {
    errors.push('respawnSeconds must be a finite non-negative number');
  }

  const weapon = definition.weapon;
  if (weapon) {
    if (!isFiniteNumber(weapon.fireIntervalSeconds) || weapon.fireIntervalSeconds <= 0) {
      errors.push('weapon.fireIntervalSeconds must be a finite positive number');
    }
    if (!isFiniteNumber(weapon.projectileSpeed) || weapon.projectileSpeed <= 0) {
      errors.push('weapon.projectileSpeed must be a finite positive number');
    }
    if (!isFiniteNumber(weapon.damage) || weapon.damage <= 0) {
      errors.push('weapon.damage must be a finite positive number');
    }
    if (!isFiniteNumber(weapon.projectileRadius) || weapon.projectileRadius <= 0) {
      errors.push('weapon.projectileRadius must be a finite positive number');
    }
    if (
      !isFiniteNumber(weapon.projectileLifetimeSeconds) ||
      weapon.projectileLifetimeSeconds <= 0
    ) {
      errors.push('weapon.projectileLifetimeSeconds must be a finite positive number');
    }
    if (!isFiniteNumber(weapon.range) || weapon.range <= 0) {
      errors.push('weapon.range must be a finite positive number');
    }
    if (!isFiniteNumber(weapon.muzzleOffset) || weapon.muzzleOffset < 0) {
      errors.push('weapon.muzzleOffset must be a finite non-negative number');
    }
    if (!isFiniteNumber(weapon.spreadRadians) || weapon.spreadRadians < 0) {
      errors.push('weapon.spreadRadians must be a finite non-negative number');
    }
    if (!isFiniteNumber(weapon.turnRateRadians) || weapon.turnRateRadians <= 0) {
      errors.push('weapon.turnRateRadians must be a finite positive number');
    }
  }

  return errors;
}
