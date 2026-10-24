import { describe, expect, it } from 'vitest';
import {
  CANNON,
  DEFAULT_LOADOUT,
  MACHINE_GUN,
  validateLoadout,
  validateWeaponConfig,
  WEAPON_CONFIGS,
  type WeaponConfig,
} from './weapons';

function cloneWeapon(weapon: WeaponConfig): WeaponConfig {
  return JSON.parse(JSON.stringify(weapon)) as WeaponConfig;
}

describe('weapon config', () => {
  it('registers valid starter weapons', () => {
    expect(validateWeaponConfig(MACHINE_GUN)).toEqual([]);
    expect(validateWeaponConfig(CANNON)).toEqual([]);
    expect(WEAPON_CONFIGS[MACHINE_GUN.id]).toBe(MACHINE_GUN);
    expect(WEAPON_CONFIGS[CANNON.id]).toBe(CANNON);
  });

  it('ships a valid default loadout', () => {
    expect(validateLoadout(DEFAULT_LOADOUT)).toEqual([]);
    expect(DEFAULT_LOADOUT).toHaveLength(2);
  });

  it('rejects invalid magazine, reload and fire rate values', () => {
    const weapon = cloneWeapon(MACHINE_GUN);
    (weapon as { magazineSize: number }).magazineSize = 0;
    (weapon as { reloadSeconds: number }).reloadSeconds = -1;
    (weapon as { fireIntervalSeconds: number }).fireIntervalSeconds = 0;

    const errors = validateWeaponConfig(weapon);
    expect(errors).toContain('magazineSize must be an integer >= 1');
    expect(errors).toContain('reloadSeconds must be a finite positive number');
    expect(errors).toContain('fireIntervalSeconds must be a finite positive number');
  });

  it('rejects invalid projectile ballistics', () => {
    const weapon = cloneWeapon(CANNON);
    (weapon.projectile as { speed: number }).speed = 0;
    (weapon.projectile as { damage: number }).damage = Number.NaN;
    (weapon.projectile as { radius: number }).radius = -0.1;
    (weapon.projectile as { lifetimeSeconds: number }).lifetimeSeconds = 0;

    const errors = validateWeaponConfig(weapon);
    expect(errors).toContain('projectile.speed must be a finite positive number');
    expect(errors).toContain('projectile.damage must be a finite positive number');
    expect(errors).toContain('projectile.radius must be a finite positive number');
    expect(errors).toContain('projectile.lifetimeSeconds must be a finite positive number');
  });

  it('rejects loadouts with unknown weapons or bad ammo', () => {
    expect(validateLoadout([{ weaponId: 'laser', reserveAmmo: 10 }])).toEqual([
      'slot 0 references unknown weapon "laser"',
    ]);
    expect(validateLoadout([{ weaponId: MACHINE_GUN.id, reserveAmmo: 1.5 }])).toEqual([
      'slot 0 reserveAmmo must be a non-negative integer',
    ]);
    expect(validateLoadout([])).toEqual(['loadout must contain at least one weapon slot']);
  });
});
