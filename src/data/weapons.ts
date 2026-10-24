/**
 * Typed weapon and projectile configuration.
 *
 * Weapons are data: fire rate, magazine, reload, spread and projectile
 * ballistics all live here so later garage upgrades can swap stats without
 * touching simulation code.
 */

export type ProjectileKind = 'bullet' | 'shell';

export interface ProjectileConfig {
  /** Muzzle speed, world units per second. */
  readonly speed: number;
  /** Damage applied on the first enemy hit. */
  readonly damage: number;
  /** Collision circle radius, world units. */
  readonly radius: number;
  /** Maximum flight time before the projectile despawns, seconds. */
  readonly lifetimeSeconds: number;
}

export interface WeaponConfig {
  readonly id: string;
  readonly displayName: string;
  /** Short label for the compact HUD. */
  readonly shortName: string;
  readonly projectileKind: ProjectileKind;
  readonly projectile: ProjectileConfig;
  readonly magazineSize: number;
  readonly reloadSeconds: number;
  /** Minimum seconds between shots. */
  readonly fireIntervalSeconds: number;
  /** Distance from the vehicle center to the muzzle, world units. */
  readonly muzzleOffset: number;
  /** Random angular spread (half-width), radians. */
  readonly spreadRadians: number;
}

export interface WeaponSlotConfig {
  readonly weaponId: string;
  /** Rounds available for reloads, excluding the loaded magazine. */
  readonly reserveAmmo: number;
}

export const MACHINE_GUN: WeaponConfig = {
  id: 'machine-gun',
  displayName: 'Scrap Machine Gun',
  shortName: 'MG',
  projectileKind: 'bullet',
  projectile: {
    speed: 60,
    damage: 7,
    radius: 0.18,
    lifetimeSeconds: 1.2,
  },
  magazineSize: 32,
  reloadSeconds: 1.7,
  fireIntervalSeconds: 0.09,
  muzzleOffset: 1.6,
  spreadRadians: 0.03,
};

export const CANNON: WeaponConfig = {
  id: 'cannon',
  displayName: 'Salvage Cannon',
  shortName: 'CANNON',
  projectileKind: 'shell',
  projectile: {
    speed: 42,
    damage: 42,
    radius: 0.32,
    lifetimeSeconds: 1.5,
  },
  magazineSize: 6,
  reloadSeconds: 2.4,
  fireIntervalSeconds: 0.75,
  muzzleOffset: 1.8,
  spreadRadians: 0.008,
};

export const WEAPON_CONFIGS: Readonly<Record<string, WeaponConfig>> = {
  [MACHINE_GUN.id]: MACHINE_GUN,
  [CANNON.id]: CANNON,
};

export const DEFAULT_LOADOUT: readonly WeaponSlotConfig[] = [
  { weaponId: MACHINE_GUN.id, reserveAmmo: 192 },
  { weaponId: CANNON.id, reserveAmmo: 24 },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateWeaponConfig(config: WeaponConfig): readonly string[] {
  const errors: string[] = [];

  if (config.id.trim().length === 0) errors.push('id must be a non-empty string');
  if (config.displayName.trim().length === 0) {
    errors.push('displayName must be a non-empty string');
  }
  if (config.shortName.trim().length === 0) {
    errors.push('shortName must be a non-empty string');
  }
  if (!Number.isInteger(config.magazineSize) || config.magazineSize < 1) {
    errors.push('magazineSize must be an integer >= 1');
  }
  if (!isFiniteNumber(config.reloadSeconds) || config.reloadSeconds <= 0) {
    errors.push('reloadSeconds must be a finite positive number');
  }
  if (!isFiniteNumber(config.fireIntervalSeconds) || config.fireIntervalSeconds <= 0) {
    errors.push('fireIntervalSeconds must be a finite positive number');
  }
  if (!isFiniteNumber(config.muzzleOffset) || config.muzzleOffset < 0) {
    errors.push('muzzleOffset must be a finite non-negative number');
  }
  if (!isFiniteNumber(config.spreadRadians) || config.spreadRadians < 0) {
    errors.push('spreadRadians must be a finite non-negative number');
  }
  if (!isFiniteNumber(config.projectile.speed) || config.projectile.speed <= 0) {
    errors.push('projectile.speed must be a finite positive number');
  }
  if (!isFiniteNumber(config.projectile.damage) || config.projectile.damage <= 0) {
    errors.push('projectile.damage must be a finite positive number');
  }
  if (!isFiniteNumber(config.projectile.radius) || config.projectile.radius <= 0) {
    errors.push('projectile.radius must be a finite positive number');
  }
  if (
    !isFiniteNumber(config.projectile.lifetimeSeconds) ||
    config.projectile.lifetimeSeconds <= 0
  ) {
    errors.push('projectile.lifetimeSeconds must be a finite positive number');
  }

  return errors;
}

export function assertValidWeaponConfig(config: WeaponConfig): void {
  const errors = validateWeaponConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid weapon config "${config.id}": ${errors.join('; ')}`);
  }
}

/** Validates that every loadout slot references a known weapon and valid ammo. */
export function validateLoadout(loadout: readonly WeaponSlotConfig[]): readonly string[] {
  const errors: string[] = [];
  if (loadout.length === 0) {
    errors.push('loadout must contain at least one weapon slot');
  }
  loadout.forEach((slot, index) => {
    if (!WEAPON_CONFIGS[slot.weaponId]) {
      errors.push(`slot ${index} references unknown weapon "${slot.weaponId}"`);
    }
    if (!Number.isInteger(slot.reserveAmmo) || slot.reserveAmmo < 0) {
      errors.push(`slot ${index} reserveAmmo must be a non-negative integer`);
    }
  });
  return errors;
}

for (const weapon of Object.values(WEAPON_CONFIGS)) {
  assertValidWeaponConfig(weapon);
}
