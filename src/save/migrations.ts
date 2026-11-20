/**
 * Ordered save migrations.
 *
 * Each migration takes a raw version-N envelope and returns a raw version-N+1
 * envelope. Keeping them as plain data transformations makes them easy to test
 * with hand-written legacy fixtures and keeps IndexedDB out of the pure layer.
 */

import { GAME_CONFIG, type GameplayConfig } from '../data/gameplay';
import { ENEMY_DEFINITIONS, type EnemyKind } from '../data/enemies';
import { EQUIPMENT_SLOTS, UPGRADE_TRACK_KINDS } from '../data/garage';
import { WEAPON_CONFIGS } from '../data/weapons';
import { AUTO_DRIVE_CONTROLS } from '../sim/input/DriveCommand';
import { DEFAULT_AIM_CONTROLS } from '../sim/input/AimCommand';
import {
  SAVE_SCHEMA_VERSION,
  type SaveFile,
} from '../sim/persistence/SerializedGameState';
import { asAmounts, asSaveFile, isRecord } from './validateSave';

export type SaveMigrationCode =
  | 'not-a-save'
  | 'unsupported-version'
  | 'newer-version'
  | 'invalid-save';

export class SaveMigrationError extends Error {
  readonly code: SaveMigrationCode;
  readonly details: readonly string[];

  constructor(code: SaveMigrationCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'SaveMigrationError';
    this.code = code;
    this.details = details;
  }
}

type RawObject = Record<string, unknown>;

function rawObject(value: unknown): RawObject {
  return isRecord(value) ? { ...value } : {};
}

function rawNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rawInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? (value as number) : fallback;
}

function rawString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * v1 → v2.
 *
 * Version 1 stored the trunk, garage levels and fitted modules but had no
 * locker, depletion map, RNG state or enemy timers. Those are filled with
 * deterministic defaults so an old slot stays playable.
 */
function migrateV1ToV2(raw: RawObject): RawObject {
  const config = (isRecord(raw.config) ? raw.config : GAME_CONFIG) as unknown as GameplayConfig;
  const game = rawObject(raw.game);
  const vehicle = rawObject(game.vehicle);
  const garage = rawObject(game.garage);
  const economy = rawObject(game.economy);
  const bases = rawObject(game.bases);
  const cargo = asAmounts(economy.cargo) ?? { scrap: 0, fuel: 0, water: 0 };

  const rawSlots = Array.isArray(garage.slots) ? garage.slots : [];
  const slots = rawSlots.map((entry, index) => {
    const slot = rawObject(entry);
    const moduleId = typeof slot.moduleId === 'string' ? slot.moduleId : null;
    const weapon = moduleId ? WEAPON_CONFIGS[moduleId] : undefined;
    return {
      slotId: rawString(slot.slotId, EQUIPMENT_SLOTS[index]?.id ?? `slot-${index}`),
      moduleId,
      ammoInMagazine: rawInteger(slot.ammoInMagazine, weapon?.magazineSize ?? 0),
      reserveAmmo: rawInteger(slot.reserveAmmo, 0),
    };
  });

  const levels: Record<string, number> = {};
  const rawLevels = rawObject(garage.levels);
  for (const track of UPGRADE_TRACK_KINDS) {
    levels[track] = rawInteger(rawLevels[track], 0);
  }

  const rawDepletion = rawObject(economy.depletion);
  const depletion: Record<string, number> = {};
  for (const [nodeId, remaining] of Object.entries(rawDepletion)) {
    if (typeof remaining === 'number' && Number.isFinite(remaining)) {
      depletion[nodeId] = Math.max(0, remaining);
    }
  }

  // v1 kept bases directly under `game.bases`; v2 groups them with raid state.
  const rawItems = Array.isArray(bases.items) ? bases.items : Array.isArray(game.bases) ? game.bases : [];
  const items = rawItems.map((entry) => {
    const base = rawObject(entry);
    const rawStructures = Array.isArray(base.structures) ? base.structures : [];
    return {
      ...base,
      storage: asAmounts(base.storage) ?? { scrap: 0, fuel: 0, water: 0 },
      structures: rawStructures.map((structure) => {
        const value = rawObject(structure);
        return {
          ...value,
          condition: rawNumber(value.condition, 1),
          active: value.active !== false,
        };
      }),
      captured: valueBoolean(base.captured),
    };
  });

  const remote = rawObject(game.remote);
  const migrated: RawObject = {
    ...raw,
    schemaVersion: 2,
    game: {
      ...game,
      tick: rawInteger(game.tick, 0),
      rngState: rawInteger(game.rngState, config.worldSeed),
      vehicle: {
        x: rawNumber(vehicle.x, config.vehicle.spawn.x),
        y: rawNumber(vehicle.y, config.vehicle.spawn.y),
        heading: rawNumber(vehicle.heading, config.vehicle.spawn.headingRadians),
        steering: rawNumber(vehicle.steering, 0),
        vx: rawNumber(vehicle.vx, 0),
        vy: rawNumber(vehicle.vy, 0),
        health: rawNumber(vehicle.health, 100),
        destroyed: valueBoolean(vehicle.destroyed),
        respawnRemainingSeconds: rawNumber(vehicle.respawnRemainingSeconds, 0),
      },
      garage: {
        slots,
        selectedSlot: rawInteger(garage.selectedSlot, 0),
        levels,
        locker: Array.isArray(garage.locker) ? garage.locker : [],
      },
      economy: { cargo, depletion, propHealth: rawObject(economy.propHealth) },
      bases: {
        selectedBaseIndex: rawInteger(bases.selectedBaseIndex, 0),
        items,
        raidCooldownSeconds: rawNumber(
          bases.raidCooldownSeconds,
          config.raids.firstDelaySeconds,
        ),
        nextRaidId: rawInteger(bases.nextRaidId, 1),
        raids: Array.isArray(bases.raids) ? bases.raids : [],
        reports: Array.isArray(bases.reports) ? bases.reports : [],
      },
      enemies: Array.isArray(game.enemies) ? game.enemies : [],
      remote: {
        accumulator: rawNumber(remote.accumulator, 0),
        ticks: rawInteger(remote.ticks, 0),
        reports: Array.isArray(remote.reports) ? remote.reports : [],
        nextReportId: rawInteger(remote.nextReportId, 1),
      },
    },
  };
  return migrated;
}

/** v4 → v5: split shared fractional accumulators by resource kind. */
function migrateV4ToV5(raw: RawObject): RawObject {
  const game = rawObject(raw.game);
  const basesRecord = rawObject(game.bases);
  const bases = Array.isArray(basesRecord.items) ? basesRecord.items : [];
  const zero = (): Record<string, number> => ({ scrap: 0, fuel: 0, water: 0 });
  return {
    ...raw,
    schemaVersion: 5,
    game: {
      ...game,
      bases: {
        ...basesRecord,
        items: bases.map((entry) => {
          const base = rawObject(entry);
          const structures = Array.isArray(base.structures) ? base.structures : [];
          return {
            ...base,
            structures: structures.map((item) => {
              const structure = rawObject(item);
              const upkeep = rawObject(structure.upkeepProgress);
              const production = rawObject(structure.productionProgress);
              const byKind = (value: RawObject): Record<string, number> => {
                const result = zero();
                for (const kind of ['scrap', 'fuel', 'water'] as const) {
                  const rate = value[kind];
                  if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0) {
                    result[kind] = rate;
                  }
                }
                return result;
              };
              return {
                ...structure,
                upkeepProgress: byKind(typeof structure.upkeepProgress === 'number' ? {} : upkeep),
                productionProgress: byKind(
                  typeof structure.productionProgress === 'number' ? {} : production,
                ),
              };
            }),
          };
        }),
      },
    },
  };
}

/** v3 → v4: record damage to solid props so destroyed cover stays destroyed. */
function migrateV3ToV4(raw: RawObject): RawObject {
  const game = rawObject(raw.game);
  const economy = rawObject(game.economy);
  const rawPropHealth = isRecord(economy.propHealth)
    ? economy.propHealth
    : isRecord(game.propHealth)
      ? game.propHealth
      : {};
  const propHealth: Record<string, number> = {};
  for (const [id, health] of Object.entries(rawPropHealth)) {
    if (typeof health === 'number' && Number.isFinite(health) && health >= 0) {
      propHealth[id] = health;
    }
  }
  return {
    ...raw,
    schemaVersion: 4,
    game: {
      ...game,
      economy: { ...economy, propHealth },
    },
  };
}

function valueBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * v2 → v3.
 *
 * Version 2 described enemy positions and timers but not the immutable body
 * data or raid ownership. Without those fields a live raider could not be
 * rebuilt after loading a save made during a raid. Older entries fall back to
 * their definition and current position.
 */
function migrateV2ToV3(raw: RawObject): RawObject {
  const game = rawObject(raw.game);
  const rawEnemies = Array.isArray(game.enemies) ? game.enemies : [];
  const enemies = rawEnemies.map((entry) => {
    const enemy = rawObject(entry);
    const definition = ENEMY_DEFINITIONS[enemy.kind as EnemyKind];
    const x = rawNumber(enemy.x, 0);
    const y = rawNumber(enemy.y, 0);
    return {
      ...enemy,
      raidId: typeof enemy.raidId === 'string' ? enemy.raidId : null,
      spawnX: rawNumber(enemy.spawnX, x),
      spawnY: rawNumber(enemy.spawnY, y),
      radius: rawNumber(enemy.radius, definition?.radius ?? 0.6),
      maxHealth: rawNumber(enemy.maxHealth, definition?.maxHealth ?? rawNumber(enemy.health, 1)),
    };
  });

  return {
    ...raw,
    schemaVersion: 3,
    game: {
      ...game,
      enemies,
      controls: game.controls ?? { ...AUTO_DRIVE_CONTROLS },
      aim: game.aim ?? { ...DEFAULT_AIM_CONTROLS },
      nextIds: game.nextIds ?? { projectile: 1, effect: 1, enemy: 1 },
    },
  };
}

export const SAVE_MIGRATIONS: Readonly<Record<number, (raw: RawObject) => RawObject>> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
  4: migrateV4ToV5,
};

/** Migrates raw IndexedDB data to the current schema and validates the result. */
export function migrateSaveFile(value: unknown): SaveFile {
  if (!isRecord(value)) {
    throw new SaveMigrationError('not-a-save', 'Сохранение не является объектом');
  }
  const version = value.schemaVersion === undefined ? 1 : value.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SaveMigrationError('unsupported-version', `Неизвестная версия сохранения: ${String(version)}`);
  }
  if (version > SAVE_SCHEMA_VERSION) {
    throw new SaveMigrationError(
      'newer-version',
      `Сохранение версии ${version} новее игры (${SAVE_SCHEMA_VERSION})`,
    );
  }

  let raw: RawObject = { ...value };
  for (let from = version; from < SAVE_SCHEMA_VERSION; from += 1) {
    const migration = SAVE_MIGRATIONS[from];
    if (!migration) {
      throw new SaveMigrationError(
        'unsupported-version',
        `Нет миграции с версии ${from} на ${from + 1}`,
      );
    }
    raw = migration(raw);
  }

  try {
    return asSaveFile(raw);
  } catch (error) {
    throw new SaveMigrationError(
      'invalid-save',
      error instanceof Error ? error.message : String(error),
    );
  }
}
