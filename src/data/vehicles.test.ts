import { describe, expect, it } from 'vitest';
import {
  assertValidVehicleConfig,
  SCRAP_RUNNER,
  VEHICLE_CONFIGS,
  validateVehicleConfig,
  type VehicleConfig,
} from './vehicles';

function cloneConfig(): VehicleConfig {
  return JSON.parse(JSON.stringify(SCRAP_RUNNER)) as VehicleConfig;
}

describe('vehicle config', () => {
  it('has a valid starter vehicle registered by id', () => {
    expect(validateVehicleConfig(SCRAP_RUNNER)).toEqual([]);
    expect(VEHICLE_CONFIGS[SCRAP_RUNNER.id]).toBe(SCRAP_RUNNER);
    expect(() => assertValidVehicleConfig(SCRAP_RUNNER)).not.toThrow();
  });

  it('rejects empty identity fields', () => {
    const config = cloneConfig();
    (config as { id: string }).id = '  ';
    (config as { displayName: string }).displayName = '';

    expect(validateVehicleConfig(config)).toEqual([
      'id must be a non-empty string',
      'displayName must be a non-empty string',
    ]);
  });

  it('rejects non-finite and negative physics values', () => {
    const config = cloneConfig();
    (config.physics as { maxForwardSpeed: number }).maxForwardSpeed = 0;
    (config.physics as { engineAcceleration: number }).engineAcceleration = Number.NaN;
    (config.physics as { lateralGrip: number }).lateralGrip = -1;

    const errors = validateVehicleConfig(config);
    expect(errors).toContain('physics.maxForwardSpeed must be a finite positive number');
    expect(errors).toContain('physics.engineAcceleration must be a finite positive number');
    expect(errors).toContain('physics.lateralGrip must be a finite non-negative number');
  });

  it('rejects out-of-range unit values and collision settings', () => {
    const config = cloneConfig();
    (config.physics as { highSpeedSteerPenalty: number }).highSpeedSteerPenalty = 1.5;
    (config.collision as { restitution: number }).restitution = 2;
    (config.collision as { impactFriction: number }).impactFriction = -0.2;
    (config.collision as { radius: number }).radius = 0;

    const errors = validateVehicleConfig(config);
    expect(errors).toContain('physics.highSpeedSteerPenalty must be in [0, 1]');
    expect(errors).toContain('collision.restitution must be in [0, 1]');
    expect(errors).toContain('collision.impactFriction must be in [0, 1]');
    expect(errors).toContain('collision.radius must be a finite positive number');
  });

  it('rejects invalid durability values', () => {
    const config = cloneConfig();
    (config.durability as { maxHealth: number }).maxHealth = 0;
    (config.durability as { respawnSeconds: number }).respawnSeconds = -2;

    expect(validateVehicleConfig(config)).toEqual([
      'durability.maxHealth must be a finite positive number',
      'durability.respawnSeconds must be a finite non-negative number',
    ]);
  });

  it('ships a starter vehicle that can actually be wrecked and recover', () => {
    expect(SCRAP_RUNNER.durability.maxHealth).toBeGreaterThan(0);
    expect(SCRAP_RUNNER.durability.respawnSeconds).toBeGreaterThan(0);
  });

  it('throws a descriptive error for an invalid config', () => {
    const config = cloneConfig();
    (config.spawn as { x: number }).x = Number.POSITIVE_INFINITY;

    expect(() => assertValidVehicleConfig(config)).toThrowError(
      /Invalid vehicle config "scrap-runner": spawn\.x must be a finite number/,
    );
  });
});
