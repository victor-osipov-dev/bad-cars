/** Typed enemy definitions and the fixed target-dummy layout of the range. */

export type EnemyKind = 'scrap-dummy' | 'heavy-dummy' | 'raider';

/**
 * How an enemy behaves.
 *
 * `stationary` enemies never leave their spawn: they are target dummies and
 * base turrets. `patrol` enemies wander around home, chase the player when
 * they notice them, and give up when they stray too far or stall.
 */
export interface EnemyAIConfig {
  readonly behaviour: 'stationary' | 'patrol';
  /** Radius of the idle patrol circle around home, world units. */
  readonly patrolRadius: number;
  /** Distance at which the player is noticed. */
  readonly detectionRadius: number;
  /** Distance at which the enemy stops approaching and opens fire. */
  readonly preferredRange: number;
  /** Movement speed while chasing, units per second. */
  readonly chaseSpeed: number;
  /** Movement speed while patrolling or returning home. */
  readonly patrolSpeed: number;
  /** Maximum distance from home before it breaks off and returns. */
  readonly leashRadius: number;
  /** Seconds of chasing without closing distance before giving up. */
  readonly chaseTimeoutSeconds: number;
}

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
  readonly ai: EnemyAIConfig;
}

export const ENEMY_DEFINITIONS: Readonly<Record<EnemyKind, EnemyDefinition>> = {
  'scrap-dummy': {
    displayName: 'Scrap Dummy',
    maxHealth: 60,
    radius: 0.9,
    respawnSeconds: 7,
    ai: {
      behaviour: 'stationary',
      patrolRadius: 0,
      detectionRadius: 26,
      preferredRange: 26,
      chaseSpeed: 0,
      patrolSpeed: 0,
      leashRadius: 0,
      chaseTimeoutSeconds: 0,
    },
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
    ai: {
      behaviour: 'stationary',
      patrolRadius: 0,
      detectionRadius: 30,
      preferredRange: 30,
      chaseSpeed: 0,
      patrolSpeed: 0,
      leashRadius: 0,
      chaseTimeoutSeconds: 0,
    },
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
  raider: {
    displayName: 'Raider Buggy',
    maxHealth: 45,
    radius: 1.1,
    // Mobile raiders are not respawned by timer; the spawn budget replaces them.
    respawnSeconds: 0,
    ai: {
      behaviour: 'patrol',
      patrolRadius: 9,
      detectionRadius: 34,
      preferredRange: 11,
      chaseSpeed: 9.5,
      patrolSpeed: 4.5,
      leashRadius: 58,
      chaseTimeoutSeconds: 12,
    },
    weapon: {
      fireIntervalSeconds: 1.1,
      projectileSpeed: 30,
      damage: 6,
      projectileRadius: 0.18,
      projectileLifetimeSeconds: 1.6,
      range: 17,
      muzzleOffset: 1.2,
      spreadRadians: 0.07,
      turnRateRadians: 3.4,
    },
  },
};

/** Global limits that keep the AI cheap and bounded. */
export interface EnemyAIConfigGlobal {
  /** Maximum number of mobile enemies alive at once (AI budget). */
  readonly maxMobileEnemies: number;
  /** Seconds between spawn attempts. */
  readonly spawnIntervalSeconds: number;
  readonly spawnRadiusMin: number;
  readonly spawnRadiusMax: number;
  /** Mobile enemies further than this from the player are removed. */
  readonly despawnRadius: number;
}

export const ENEMY_AI_CONFIG: EnemyAIConfigGlobal = {
  maxMobileEnemies: 3,
  spawnIntervalSeconds: 9,
  spawnRadiusMin: 34,
  spawnRadiusMax: 52,
  despawnRadius: 95,
};

export function validateEnemyAIConfig(
  config: EnemyAIConfigGlobal,
): readonly string[] {
  const errors: string[] = [];
  if (!Number.isInteger(config.maxMobileEnemies) || config.maxMobileEnemies < 0) {
    errors.push('maxMobileEnemies must be a non-negative integer');
  }
  if (!Number.isFinite(config.spawnIntervalSeconds) || config.spawnIntervalSeconds <= 0) {
    errors.push('spawnIntervalSeconds must be a finite positive number');
  }
  if (
    !Number.isFinite(config.spawnRadiusMin) ||
    !Number.isFinite(config.spawnRadiusMax) ||
    config.spawnRadiusMin <= 0 ||
    config.spawnRadiusMax < config.spawnRadiusMin
  ) {
    errors.push('spawn radii must be finite and ordered (min > 0, max >= min)');
  }
  if (!Number.isFinite(config.despawnRadius) || config.despawnRadius <= config.spawnRadiusMax) {
    errors.push('despawnRadius must be greater than spawnRadiusMax');
  }
  return errors;
}

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
