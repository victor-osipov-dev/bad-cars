import { describe, expect, it } from 'vitest';
import {
  ENEMY_DEFINITIONS,
  ENEMY_SPAWNS,
  validateEnemyDefinition,
  type EnemyDefinition,
} from './enemies';

function cloneDefinition(kind: keyof typeof ENEMY_DEFINITIONS): EnemyDefinition {
  return JSON.parse(JSON.stringify(ENEMY_DEFINITIONS[kind])) as EnemyDefinition;
}

describe('enemy definitions', () => {
  it('validates every shipped definition', () => {
    for (const definition of Object.values(ENEMY_DEFINITIONS)) {
      expect(validateEnemyDefinition(definition)).toEqual([]);
    }
  });

  it('every shooter has sane weapon numbers', () => {
    for (const definition of Object.values(ENEMY_DEFINITIONS)) {
      const weapon = definition.weapon;
      expect(weapon).toBeDefined();
      if (!weapon) continue;
      expect(weapon.damage).toBeGreaterThan(0);
      expect(weapon.damage).toBeLessThan(definition.maxHealth);
      expect(weapon.range).toBeGreaterThan(weapon.muzzleOffset);
      expect(weapon.fireIntervalSeconds).toBeGreaterThan(0);
    }
  });

  it('places every spawn inside the default arena', () => {
    for (const spawn of ENEMY_SPAWNS) {
      expect(Math.abs(spawn.x)).toBeLessThan(40);
      expect(Math.abs(spawn.y)).toBeLessThan(26);
    }
  });

  it('rejects invalid health, radius and respawn values', () => {
    const definition = cloneDefinition('scrap-dummy');
    (definition as { maxHealth: number }).maxHealth = 0;
    (definition as { radius: number }).radius = -1;
    (definition as { respawnSeconds: number }).respawnSeconds = Number.NaN;

    expect(validateEnemyDefinition(definition)).toEqual([
      'maxHealth must be a finite positive number',
      'radius must be a finite positive number',
      'respawnSeconds must be a finite non-negative number',
    ]);
  });

  it('rejects invalid weapon values', () => {
    const definition = cloneDefinition('heavy-dummy');
    const weapon = definition.weapon;
    if (!weapon) throw new Error('expected heavy-dummy to have a weapon');
    (weapon as { fireIntervalSeconds: number }).fireIntervalSeconds = 0;
    (weapon as { damage: number }).damage = -5;
    (weapon as { range: number }).range = 0;
    (weapon as { turnRateRadians: number }).turnRateRadians = 0;

    expect(validateEnemyDefinition(definition)).toEqual([
      'weapon.fireIntervalSeconds must be a finite positive number',
      'weapon.damage must be a finite positive number',
      'weapon.range must be a finite positive number',
      'weapon.turnRateRadians must be a finite positive number',
    ]);
  });

  it('treats a missing weapon as a harmless target dummy', () => {
    const definition = cloneDefinition('scrap-dummy');
    delete (definition as { weapon?: unknown }).weapon;

    expect(validateEnemyDefinition(definition)).toEqual([]);
  });
});
