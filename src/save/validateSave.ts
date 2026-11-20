/**
 * Structural validation for save files.
 *
 * Corrupted or future saves must be rejected *before* an import touches the
 * live world. The checks here are deliberately explicit: IndexedDB returns
 * `unknown`, and a partially written object would otherwise crash the game on
 * the first tick after load.
 */

import type { GameplayConfig } from '../data/gameplay';
import { EQUIPMENT_MODULES, EQUIPMENT_SLOTS, UPGRADE_TRACK_KINDS } from '../data/garage';
import { validateWorldConfig } from '../data/worldgen';
import { assertValidVehicleConfig } from '../data/vehicles';
import { validateLoadout } from '../data/weapons';
import type { ResourceAmounts } from '../sim/economy/EconomyState';
import type { SerializedGameState, SaveFile } from '../sim/persistence/SerializedGameState';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function checkNumber(
  value: unknown,
  path: string,
  errors: string[],
  options: { integer?: boolean; min?: number } = {},
): void {
  const label = options.integer ? 'integer' : 'finite number';
  if (options.integer ? !isInteger(value) : !isFiniteNumber(value)) {
    errors.push(`${path} must be a ${label}`);
    return;
  }
  if (options.min !== undefined && (value as number) < options.min) {
    errors.push(`${path} must be >= ${options.min}`);
  }
}

function checkAmounts(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const kind of ['scrap', 'fuel', 'water'] as const) {
    checkNumber(value[kind], `${path}.${kind}`, errors, { integer: true, min: 0 });
  }
}

function checkArray(value: unknown, path: string, errors: string[]): readonly unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  return value;
}

function checkConfig(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('game.config must be an object');
    return;
  }
  checkNumber(value.fixedStepHz, 'game.config.fixedStepHz', errors, { min: 1 });
  checkNumber(value.maxSubSteps, 'game.config.maxSubSteps', errors, { integer: true, min: 1 });
  checkNumber(
    value.maxFrameDeltaSeconds,
    'game.config.maxFrameDeltaSeconds',
    errors,
    { min: 0 },
  );
  checkNumber(value.dayLengthSeconds, 'game.config.dayLengthSeconds', errors, { min: 1 });
  checkNumber(value.worldSeed, 'game.config.worldSeed', errors, { integer: true });

  const config = value as unknown as GameplayConfig;
  if (isRecord(value.world)) {
    errors.push(...validateWorldConfig(config.world));
  }
  if (Array.isArray(value.loadout)) {
    errors.push(...validateLoadout(config.loadout));
  }
  if (isRecord(value.vehicle)) {
    try {
      assertValidVehicleConfig(config.vehicle);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

/** Validates a version-2 game state; returns a list of human-readable errors. */
export function validateSerializedGameState(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['game must be an object'];
  const game = value as Record<string, unknown>;

  checkConfig(game.config, errors);
  checkNumber(game.tick, 'game.tick', errors, { integer: true, min: 0 });
  checkNumber(game.rngState, 'game.rngState', errors, { integer: true, min: 0 });

  const controls = game.controls;
  if (!isRecord(controls)) {
    errors.push('game.controls must be an object');
  } else {
    for (const field of ['steer', 'throttle', 'brake', 'reverse'] as const) {
      checkNumber(controls[field], `game.controls.${field}`, errors);
    }
    for (const field of ['handbrake', 'interact'] as const) {
      if (typeof controls[field] !== 'boolean') {
        errors.push(`game.controls.${field} must be a boolean`);
      }
    }
    for (const field of ['foundBaseToken', 'buildToken', 'cycleBaseToken'] as const) {
      checkNumber(controls[field], `game.controls.${field}`, errors, { integer: true, min: 0 });
    }
  }

  const aim = game.aim;
  if (!isRecord(aim)) {
    errors.push('game.aim must be an object');
  } else {
    if (typeof aim.fire !== 'boolean') errors.push('game.aim.fire must be a boolean');
    checkNumber(aim.activeSlot, 'game.aim.activeSlot', errors, { integer: true, min: 0 });
    checkNumber(aim.reloadToken, 'game.aim.reloadToken', errors, { integer: true, min: 0 });
    if (aim.aimPoint !== null) {
      if (!isRecord(aim.aimPoint)) {
        errors.push('game.aim.aimPoint must be an object or null');
      } else {
        checkNumber(aim.aimPoint.x, 'game.aim.aimPoint.x', errors);
        checkNumber(aim.aimPoint.y, 'game.aim.aimPoint.y', errors);
      }
    }
  }

  const nextIds = game.nextIds;
  if (!isRecord(nextIds)) {
    errors.push('game.nextIds must be an object');
  } else {
    for (const field of ['projectile', 'effect', 'enemy'] as const) {
      checkNumber(nextIds[field], `game.nextIds.${field}`, errors, { integer: true, min: 1 });
    }
  }

  const vehicle = game.vehicle;
  if (!isRecord(vehicle)) {
    errors.push('game.vehicle must be an object');
  } else {
    checkNumber(vehicle.x, 'game.vehicle.x', errors);
    checkNumber(vehicle.y, 'game.vehicle.y', errors);
    checkNumber(vehicle.heading, 'game.vehicle.heading', errors);
    checkNumber(vehicle.steering, 'game.vehicle.steering', errors);
    checkNumber(vehicle.vx, 'game.vehicle.vx', errors);
    checkNumber(vehicle.vy, 'game.vehicle.vy', errors);
    checkNumber(vehicle.health, 'game.vehicle.health', errors, { min: 0 });
    if (typeof vehicle.destroyed !== 'boolean') {
      errors.push('game.vehicle.destroyed must be a boolean');
    }
    checkNumber(
      vehicle.respawnRemainingSeconds,
      'game.vehicle.respawnRemainingSeconds',
      errors,
      { min: 0 },
    );
  }

  const garage = game.garage;
  if (!isRecord(garage)) {
    errors.push('game.garage must be an object');
  } else {
    const slots = checkArray(garage.slots, 'game.garage.slots', errors);
    for (const [index, rawSlot] of slots.entries()) {
      if (!isRecord(rawSlot)) {
        errors.push(`game.garage.slots[${index}] must be an object`);
        continue;
      }
      if (typeof rawSlot.slotId !== 'string' || !EQUIPMENT_SLOTS.some((slot) => slot.id === rawSlot.slotId)) {
        errors.push(`game.garage.slots[${index}].slotId is unknown`);
      }
      if (rawSlot.moduleId !== null && typeof rawSlot.moduleId !== 'string') {
        errors.push(`game.garage.slots[${index}].moduleId must be a string or null`);
      } else if (
        typeof rawSlot.moduleId === 'string' &&
        EQUIPMENT_MODULES[rawSlot.moduleId] === undefined
      ) {
        errors.push(`game.garage.slots[${index}].moduleId is unknown`);
      }
      checkNumber(
        rawSlot.ammoInMagazine,
        `game.garage.slots[${index}].ammoInMagazine`,
        errors,
        { integer: true, min: 0 },
      );
      checkNumber(
        rawSlot.reserveAmmo,
        `game.garage.slots[${index}].reserveAmmo`,
        errors,
        { integer: true, min: 0 },
      );
    }
    checkNumber(
      garage.selectedSlot,
      'game.garage.selectedSlot',
      errors,
      { integer: true, min: 0 },
    );
    if (isInteger(garage.selectedSlot) && garage.selectedSlot >= slots.length) {
      errors.push('game.garage.selectedSlot is out of range');
    }
    if (!isRecord(garage.levels)) {
      errors.push('game.garage.levels must be an object');
    } else {
      for (const track of UPGRADE_TRACK_KINDS) {
        checkNumber(garage.levels[track], `game.garage.levels.${track}`, errors, {
          integer: true,
          min: 0,
        });
      }
    }
    const locker = checkArray(garage.locker, 'game.garage.locker', errors);
    for (const [index, rawEntry] of locker.entries()) {
      if (!isRecord(rawEntry)) {
        errors.push(`game.garage.locker[${index}] must be an object`);
        continue;
      }
      if (typeof rawEntry.moduleId !== 'string' || EQUIPMENT_MODULES[rawEntry.moduleId] === undefined) {
        errors.push(`game.garage.locker[${index}].moduleId is unknown`);
      }
      checkNumber(
        rawEntry.ammoInMagazine,
        `game.garage.locker[${index}].ammoInMagazine`,
        errors,
        { integer: true, min: 0 },
      );
      checkNumber(
        rawEntry.reserveAmmo,
        `game.garage.locker[${index}].reserveAmmo`,
        errors,
        { integer: true, min: 0 },
      );
    }
  }

  const economy = game.economy;
  if (!isRecord(economy)) {
    errors.push('game.economy must be an object');
  } else {
    const propHealth = economy.propHealth;
    if (!isRecord(propHealth)) {
      errors.push('game.economy.propHealth must be an object');
    } else {
      for (const [id, health] of Object.entries(propHealth)) {
        checkNumber(health, `game.economy.propHealth.${id}`, errors, { min: 0 });
      }
    }
    checkAmounts(economy.cargo, 'game.economy.cargo', errors);
    if (!isRecord(economy.depletion)) {
      errors.push('game.economy.depletion must be an object');
    } else {
      for (const [nodeId, remaining] of Object.entries(economy.depletion)) {
        checkNumber(remaining, `game.economy.depletion.${nodeId}`, errors, { integer: true, min: 0 });
      }
    }
  }

  const bases = game.bases;
  if (!isRecord(bases)) {
    errors.push('game.bases must be an object');
  } else {
    checkNumber(
      bases.selectedBaseIndex,
      'game.bases.selectedBaseIndex',
      errors,
      { integer: true, min: 0 },
    );
    checkNumber(
      bases.raidCooldownSeconds,
      'game.bases.raidCooldownSeconds',
      errors,
      { min: 0 },
    );
    checkNumber(bases.nextRaidId, 'game.bases.nextRaidId', errors, { integer: true, min: 1 });
    checkArray(bases.items, 'game.bases.items', errors);
    checkArray(bases.raids, 'game.bases.raids', errors);
    checkArray(bases.reports, 'game.bases.reports', errors);
    for (const [index, rawBase] of checkArray(bases.items, 'game.bases.items', errors).entries()) {
      if (!isRecord(rawBase)) {
        errors.push(`game.bases.items[${index}] must be an object`);
        continue;
      }
      if (typeof rawBase.id !== 'string' || typeof rawBase.name !== 'string') {
        errors.push(`game.bases.items[${index}] needs id and name`);
      }
      checkAmounts(rawBase.storage, `game.bases.items[${index}].storage`, errors);
      checkArray(rawBase.structures, `game.bases.items[${index}].structures`, errors);
    }
  }

  const enemies = checkArray(game.enemies, 'game.enemies', errors);
  for (const [index, rawEnemy] of enemies.entries()) {
    const path = `game.enemies[${index}]`;
    if (!isRecord(rawEnemy) || typeof rawEnemy.id !== 'string') {
      errors.push(`${path} must be an object with an id`);
      continue;
    }
    if (typeof rawEnemy.kind !== 'string') errors.push(`${path}.kind must be a string`);
    if (typeof rawEnemy.aiState !== 'string') errors.push(`${path}.aiState must be a string`);
    for (const field of ['stateSeconds', 'bestDistance', 'stallSeconds', 'patrolAngle', 'aimAngle', 'rotation', 'x', 'y', 'health', 'respawnRemainingSeconds', 'fireCooldownSeconds', 'spawnX', 'spawnY', 'radius', 'maxHealth'] as const) {
      checkNumber(rawEnemy[field], `${path}.${field}`, errors);
    }
    if (typeof rawEnemy.alive !== 'boolean') errors.push(`${path}.alive must be a boolean`);
    if (rawEnemy.raidId !== null && typeof rawEnemy.raidId !== 'string') {
      errors.push(`${path}.raidId must be a string or null`);
    }
  }

  const remote = game.remote;
  if (!isRecord(remote)) {
    errors.push('game.remote must be an object');
  } else {
    checkNumber(remote.accumulator, 'game.remote.accumulator', errors, { min: 0 });
    checkNumber(remote.ticks, 'game.remote.ticks', errors, { integer: true, min: 0 });
    checkNumber(remote.nextReportId, 'game.remote.nextReportId', errors, { integer: true, min: 1 });
    checkArray(remote.reports, 'game.remote.reports', errors);
  }

  return errors;
}

/** Validates the full envelope, including metadata. */
export function validateSaveFile(value: unknown): string[] {
  if (!isRecord(value)) return ['save file must be an object'];
  const errors: string[] = [];
  checkNumber(value.schemaVersion, 'schemaVersion', errors, { integer: true, min: 1 });
  checkNumber(value.savedAt, 'savedAt', errors, { min: 0 });
  errors.push(...validateSerializedGameState(value.game));
  return errors;
}

/** Narrowing helper for a validated save. */
export function asSaveFile(value: unknown): SaveFile {
  const errors = validateSaveFile(value);
  if (errors.length > 0) {
    throw new Error(`Invalid save file: ${errors.join('; ')}`);
  }
  return value as SaveFile;
}

/** Narrowing helper for a validated state. */
export function asGameState(value: unknown): SerializedGameState {
  const errors = validateSerializedGameState(value);
  if (errors.length > 0) {
    throw new Error(`Invalid game state: ${errors.join('; ')}`);
  }
  return value as SerializedGameState;
}

/** Typed amounts helper used by migrations. */
export function asAmounts(value: unknown): ResourceAmounts | null {
  if (!isRecord(value)) return null;
  const amounts = value as unknown as ResourceAmounts;
  return ['scrap', 'fuel', 'water'].every(
    (kind) => typeof amounts[kind as keyof ResourceAmounts] === 'number',
  )
    ? amounts
    : null;
}
