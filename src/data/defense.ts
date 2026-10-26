/**
 * Base defence and sensor tuning.
 *
 * Turret and mine numbers live here so balance work never touches simulation
 * code. Sensors are intentionally cheap: the check is one distance per enemy,
 * and the alert level is derived, not stored per enemy.
 */

export interface TurretDefenseConfig {
  /** Maximum distance at which the turret engages, world units. */
  readonly range: number;
  readonly damage: number;
  readonly fireIntervalSeconds: number;
  readonly projectileSpeed: number;
  readonly projectileRadius: number;
  readonly projectileLifetimeSeconds: number;
  /** Turret slew rate, radians per second. */
  readonly turnRateRadians: number;
  /** Distance from the turret centre to the muzzle. */
  readonly muzzleOffset: number;
  /** Aim error still accepted as "on target", radians. */
  readonly aimTolerance: number;
}

export const TURRET_DEFENSE: TurretDefenseConfig = {
  range: 22,
  damage: 9,
  fireIntervalSeconds: 0.45,
  projectileSpeed: 46,
  projectileRadius: 0.2,
  projectileLifetimeSeconds: 1.2,
  turnRateRadians: 5.5,
  muzzleOffset: 1.1,
  aimTolerance: 0.14,
};

export interface MineConfig {
  /** Distance at which an enemy sets the mine off. */
  readonly triggerRadius: number;
  /** Damage radius. */
  readonly blastRadius: number;
  readonly damage: number;
}

export const MINE_CONFIG: MineConfig = {
  triggerRadius: 2.6,
  blastRadius: 4.5,
  damage: 70,
};

export type AlertLevel = 'calm' | 'near' | 'attack';

export interface SensorConfig {
  /** Radar range around the vehicle. */
  readonly radarRadius: number;
  /** Enemies closer than this count as an attack, not just a contact. */
  readonly attackRadius: number;
  /** Extra range a base sensor watches its own surroundings. */
  readonly baseSensorRadius: number;
}

export const SENSOR_CONFIG: SensorConfig = {
  radarRadius: 42,
  attackRadius: 15,
  baseSensorRadius: 30,
};

export function validateDefenseConfigs(
  turret: TurretDefenseConfig,
  mine: MineConfig,
  sensor: SensorConfig,
): readonly string[] {
  const errors: string[] = [];

  const positive: readonly [string, number][] = [
    ['turret.range', turret.range],
    ['turret.damage', turret.damage],
    ['turret.fireIntervalSeconds', turret.fireIntervalSeconds],
    ['turret.projectileSpeed', turret.projectileSpeed],
    ['turret.projectileRadius', turret.projectileRadius],
    ['turret.projectileLifetimeSeconds', turret.projectileLifetimeSeconds],
    ['turret.turnRateRadians', turret.turnRateRadians],
    ['mine.triggerRadius', mine.triggerRadius],
    ['mine.blastRadius', mine.blastRadius],
    ['mine.damage', mine.damage],
    ['sensor.radarRadius', sensor.radarRadius],
    ['sensor.attackRadius', sensor.attackRadius],
    ['sensor.baseSensorRadius', sensor.baseSensorRadius],
  ];
  for (const [name, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${name} must be a finite positive number`);
    }
  }

  if (turret.muzzleOffset < 0 || !Number.isFinite(turret.muzzleOffset)) {
    errors.push('turret.muzzleOffset must be a finite non-negative number');
  }
  if (turret.aimTolerance <= 0 || !Number.isFinite(turret.aimTolerance)) {
    errors.push('turret.aimTolerance must be a finite positive number');
  }
  if (sensor.attackRadius > sensor.radarRadius) {
    errors.push('sensor.attackRadius cannot exceed sensor.radarRadius');
  }
  if (mine.blastRadius < mine.triggerRadius) {
    errors.push('mine.blastRadius must be at least mine.triggerRadius');
  }
  if (turret.damage > 1000) {
    errors.push('turret.damage is implausibly high');
  }

  return errors;
}
