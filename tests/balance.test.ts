import { describe, expect, it } from 'vitest';
import { STRUCTURE_DEFINITIONS, type StructureKind } from '../src/data/bases';
import { ECONOMY_CONFIG, STRUCTURE_ECONOMY, validateStructureEconomy } from '../src/data/economy';
import { PROP_DEFINITIONS } from '../src/data/gameplay';
import { INVENTORY_CONFIG } from '../src/data/resources';
import { RAID_CONFIG } from '../src/data/raids';
import { ENEMY_AI_CONFIG } from '../src/data/enemies';
import { CANNON, DEFAULT_LOADOUT, MACHINE_GUN, WEAPON_CONFIGS } from '../src/data/weapons';
import { createStructure } from '../src/sim/base/BaseState';
import { baseEconomyRates } from '../src/sim/systems/EconomySystem';

describe('MVP balance invariants', () => {
  it('lets the starter cargo pay for a depot and a workshop', () => {
    const cost = (kind: StructureKind): number =>
      STRUCTURE_DEFINITIONS[kind].cost.scrap ?? 0;
    const scrap = cost('depot') + cost('workshop');
    const water = STRUCTURE_DEFINITIONS.workshop.cost.water ?? 0;

    expect(scrap + water).toBeLessThanOrEqual(INVENTORY_CONFIG.cargoCapacity);
  });

  it('can break every destructible prop with a single starter magazine', () => {
    expect(validateStructureEconomy(STRUCTURE_ECONOMY)).toEqual([]);
    for (const weapon of [MACHINE_GUN, CANNON]) {
      expect(WEAPON_CONFIGS[weapon.id]).toBe(weapon);
      const magazineDamage = weapon.magazineSize * weapon.projectile.damage * weapon.pellets;
      for (const [kind, definition] of Object.entries(PROP_DEFINITIONS)) {
        const health = definition.health ?? 0;
        if (health <= 0) continue;
        expect(magazineDamage, `${kind} vs ${weapon.id}`).toBeGreaterThanOrEqual(health);
      }
    }
    expect(DEFAULT_LOADOUT).toHaveLength(2);
  });

  it('keeps a workshop, generator and turret base net-positive', () => {
    const kinds: StructureKind[] = ['workshop', 'generator', 'turret'];
    const structures = kinds.map((kind, index) =>
      createStructure({
        id: `struct-${kind}`,
        kind,
        x: index,
        y: 0,
        slotIndex: index,
        builtTick: 0,
        maxCondition: ECONOMY_CONFIG.maxCondition,
      }),
    );

    const rates = baseEconomyRates({
      id: 'base',
      siteId: 'site',
      name: 'База',
      x: 0,
      y: 0,
      storage: { scrap: 100, fuel: 100, water: 100 },
      structures,
      foundedTick: 0,
      scrappedCount: 0,
      minesSpent: 0,
      captured: false,
    });

    expect(rates.inactiveStructures).toBe(0);
    expect(rates.netPerMinute.scrap).toBeGreaterThan(0);
    expect(rates.netPerMinute.fuel).toBeGreaterThanOrEqual(0);
    expect(rates.netPerMinute.water).toBeGreaterThanOrEqual(0);
  });

  it('gives the player time to react before the first raid', () => {
    expect(RAID_CONFIG.firstDelaySeconds).toBeGreaterThan(RAID_CONFIG.countdownSeconds);
    expect(RAID_CONFIG.baseIntervalSeconds).toBeGreaterThan(RAID_CONFIG.minIntervalSeconds);
    expect(RAID_CONFIG.minStorageToRaid).toBeGreaterThan(
      STRUCTURE_DEFINITIONS.workshop.cost.scrap ?? 0,
    );
    expect(ENEMY_AI_CONFIG.maxMobileEnemies).toBeGreaterThan(0);
  });
});
