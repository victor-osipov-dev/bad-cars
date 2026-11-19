import { WEAPON_CONFIGS, type WeaponSlotConfig } from '../../data/weapons';
import type { CombatState } from './CombatState';

/**
 * Builds a fresh combat state from a weapon loadout.
 *
 * Shared by world creation and by the garage, which rebuilds the weapon list
 * whenever the player fits or removes a module. Keeping one constructor means
 * a starting loadout and a swapped-in loadout can never drift apart.
 */
export function createCombatState(
  loadout: readonly WeaponSlotConfig[],
  heading: number,
): CombatState {
  return {
    activeSlot: 0,
    aimAngle: heading,
    aimPoint: null,
    lastReloadToken: 0,
    weapons: loadout.map((slot) => {
      const weapon = WEAPON_CONFIGS[slot.weaponId];
      if (!weapon) {
        throw new Error(`Unknown weapon in loadout: ${slot.weaponId}`);
      }
      return {
        weaponId: weapon.id,
        ammoInMagazine: weapon.magazineSize,
        reserveAmmo: slot.reserveAmmo,
        cooldownSeconds: 0,
        reloadRemainingSeconds: 0,
      };
    }),
  };
}
