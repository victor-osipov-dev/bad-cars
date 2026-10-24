/**
 * Typed vehicle configuration (data-driven design).
 *
 * The player never leaves the car, so the vehicle is the core entity. Physics
 * values describe an arcade model: automatic throttle, speed-sensitive
 * steering, lateral grip and optional handbrake drift.
 */

export interface VehicleBodyConfig {
  /** Across the heading axis, in world units. */
  readonly width: number;
  /** Along the heading axis, in world units. */
  readonly length: number;
}

export interface VehicleSpawnConfig {
  readonly x: number;
  readonly y: number;
  readonly headingRadians: number;
}

export interface VehiclePhysicsConfig {
  /** Speed the engine can reach on flat ground, m/s. */
  readonly maxForwardSpeed: number;
  /** Speed limit when reversing, m/s. */
  readonly maxReverseSpeed: number;
  /** Acceleration at standstill, m/s^2. */
  readonly engineAcceleration: number;
  /** Brake deceleration at full brake input, m/s^2. */
  readonly brakeDeceleration: number;
  /** Constant rolling resistance, m/s^2. */
  readonly rollingResistance: number;
  /** Quadratic drag coefficient, 1/m. */
  readonly aerodynamicDrag: number;
  /** Yaw rate at full steering lock and full authority, rad/s. */
  readonly maxYawRate: number;
  /** How fast the steering input reaches full lock, 1/s. */
  readonly steerResponse: number;
  /** Lateral velocity damping while gripping, 1/s. */
  readonly lateralGrip: number;
  /** Lateral velocity damping while the handbrake is held, 1/s. */
  readonly handbrakeGrip: number;
  /** Extra deceleration while the handbrake is held, m/s^2. */
  readonly handbrakeDeceleration: number;
  /** Speed at which steering authority reaches its maximum, m/s. */
  readonly steerSpeedReference: number;
  /** Fraction of yaw authority removed at top speed, 0..1. */
  readonly highSpeedSteerPenalty: number;
}

export interface VehicleDurabilityConfig {
  /** Structural hit points before the car is wrecked. */
  readonly maxHealth: number;
  /** Seconds the wreck stays disabled before respawning at the spawn point. */
  readonly respawnSeconds: number;
}

export interface VehicleCollisionConfig {
  /** Collision circle radius, world units. */
  readonly radius: number;
  /** Normal velocity kept after an impact, 0..1. */
  readonly restitution: number;
  /** Tangential velocity lost on impact, 0..1. */
  readonly impactFriction: number;
}

export interface VehicleConfig {
  readonly id: string;
  readonly displayName: string;
  readonly body: VehicleBodyConfig;
  readonly spawn: VehicleSpawnConfig;
  readonly physics: VehiclePhysicsConfig;
  readonly collision: VehicleCollisionConfig;
  readonly durability: VehicleDurabilityConfig;
}

/** Placeholder starter vehicle; upgrades arrive in stage 12. */
export const SCRAP_RUNNER: VehicleConfig = {
  id: 'scrap-runner',
  displayName: 'Scrap Runner',
  body: { width: 1.75, length: 2.7 },
  spawn: { x: -24, y: -10, headingRadians: 0 },
  physics: {
    maxForwardSpeed: 16,
    maxReverseSpeed: 4.5,
    engineAcceleration: 11,
    brakeDeceleration: 18,
    rollingResistance: 0.7,
    aerodynamicDrag: 0.005,
    maxYawRate: 2.7,
    steerResponse: 6,
    lateralGrip: 8,
    handbrakeGrip: 1.6,
    handbrakeDeceleration: 4.5,
    steerSpeedReference: 3,
    highSpeedSteerPenalty: 0.45,
  },
  collision: {
    radius: 1,
    restitution: 0.35,
    impactFriction: 0.25,
  },
  durability: {
    maxHealth: 120,
    respawnSeconds: 3,
  },
};

export const VEHICLE_CONFIGS: Readonly<Record<string, VehicleConfig>> = {
  [SCRAP_RUNNER.id]: SCRAP_RUNNER,
};

export const DEFAULT_VEHICLE_ID = SCRAP_RUNNER.id;

const POSITIVE_PHYSICS_FIELDS = [
  'maxForwardSpeed',
  'maxReverseSpeed',
  'engineAcceleration',
  'brakeDeceleration',
  'maxYawRate',
  'steerResponse',
  'steerSpeedReference',
] as const;

const NON_NEGATIVE_PHYSICS_FIELDS = [
  'rollingResistance',
  'aerodynamicDrag',
  'lateralGrip',
  'handbrakeGrip',
  'handbrakeDeceleration',
] as const;

const UNIT_INTERVAL_PHYSICS_FIELDS = ['highSpeedSteerPenalty'] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Returns human-readable validation errors; an empty array means the config is
 * safe to hand to the simulation.
 */
export function validateVehicleConfig(config: VehicleConfig): readonly string[] {
  const errors: string[] = [];

  if (typeof config.id !== 'string' || config.id.trim().length === 0) {
    errors.push('id must be a non-empty string');
  }
  if (typeof config.displayName !== 'string' || config.displayName.trim().length === 0) {
    errors.push('displayName must be a non-empty string');
  }

  if (!isFiniteNumber(config.body.width) || config.body.width <= 0) {
    errors.push('body.width must be a finite positive number');
  }
  if (!isFiniteNumber(config.body.length) || config.body.length <= 0) {
    errors.push('body.length must be a finite positive number');
  }
  if (config.body.width > config.body.length * 4) {
    errors.push('body.width is implausibly large compared to body.length');
  }

  for (const field of ['x', 'y', 'headingRadians'] as const) {
    if (!isFiniteNumber(config.spawn[field])) {
      errors.push(`spawn.${field} must be a finite number`);
    }
  }

  for (const field of POSITIVE_PHYSICS_FIELDS) {
    if (!isFiniteNumber(config.physics[field]) || config.physics[field] <= 0) {
      errors.push(`physics.${field} must be a finite positive number`);
    }
  }
  for (const field of NON_NEGATIVE_PHYSICS_FIELDS) {
    if (!isFiniteNumber(config.physics[field]) || config.physics[field] < 0) {
      errors.push(`physics.${field} must be a finite non-negative number`);
    }
  }
  for (const field of UNIT_INTERVAL_PHYSICS_FIELDS) {
    const value = config.physics[field];
    if (!isFiniteNumber(value) || value < 0 || value > 1) {
      errors.push(`physics.${field} must be in [0, 1]`);
    }
  }

  if (!isFiniteNumber(config.collision.radius) || config.collision.radius <= 0) {
    errors.push('collision.radius must be a finite positive number');
  }
  if (!isFiniteNumber(config.collision.restitution) || config.collision.restitution < 0 ||
    config.collision.restitution > 1) {
    errors.push('collision.restitution must be in [0, 1]');
  }
  if (!isFiniteNumber(config.collision.impactFriction) || config.collision.impactFriction < 0 ||
    config.collision.impactFriction > 1) {
    errors.push('collision.impactFriction must be in [0, 1]');
  }

  if (!isFiniteNumber(config.durability.maxHealth) || config.durability.maxHealth <= 0) {
    errors.push('durability.maxHealth must be a finite positive number');
  }
  if (
    !isFiniteNumber(config.durability.respawnSeconds) ||
    config.durability.respawnSeconds < 0
  ) {
    errors.push('durability.respawnSeconds must be a finite non-negative number');
  }

  return errors;
}

export function assertValidVehicleConfig(config: VehicleConfig): void {
  const errors = validateVehicleConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid vehicle config "${config.id}": ${errors.join('; ')}`);
  }
}

assertValidVehicleConfig(SCRAP_RUNNER);
