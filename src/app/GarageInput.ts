import type { EquipmentAction } from '../sim/input/EquipmentCommand';
import type { UpgradeTrack } from '../data/garage';

/** Slot cursor keys: one per equipment bay, in `EQUIPMENT_SLOTS` order. */
const SLOT_KEYS: ReadonlyMap<string, number> = new Map([
  ['Digit1', 0],
  ['Digit2', 1],
  ['Digit3', 2],
  ['Digit4', 3],
]);

/**
 * Weapon hardpoints, in combat-slot order.
 *
 * Shared with `CombatInput` so the same digit both moves the garage cursor and
 * selects the firing slot: slot index N in the garage is weapon index N in
 * combat, which is only true because weapon bays come first in
 * `EQUIPMENT_SLOTS`.
 */
export const WEAPON_SLOT_KEYS: ReadonlyMap<string, number> = SLOT_KEYS;

const INSTALL_KEYS = new Set(['KeyG']);
const REMOVE_KEYS = new Set(['KeyH']);
const UPGRADE_KEYS: ReadonlyMap<string, UpgradeTrack> = new Map([
  ['KeyN', 'engine'],
  ['KeyM', 'chassis'],
  ['Comma', 'workshop'],
]);

/** Every key this module consumes; the app uses it to stop double handling. */
export const GARAGE_KEYS: ReadonlySet<string> = new Set([
  ...SLOT_KEYS.keys(),
  ...INSTALL_KEYS,
  ...REMOVE_KEYS,
  ...UPGRADE_KEYS.keys(),
]);

export interface GarageKeyEvent {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/**
 * Pure mapping from a key-down event to a garage action.
 *
 * Exported so the keyboard layout is unit-testable without a DOM. Returns
 * null for keys this module does not own, and for auto-repeat (so holding a
 * key buys exactly one upgrade, not one per frame).
 */
export function garageActionFromKey(event: GarageKeyEvent): EquipmentAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.repeat) return null;
  if (!GARAGE_KEYS.has(event.code)) return null;

  const slotIndex = SLOT_KEYS.get(event.code);
  if (slotIndex !== undefined) return { kind: 'select-slot', index: slotIndex };

  if (INSTALL_KEYS.has(event.code)) return { kind: 'install' };
  if (REMOVE_KEYS.has(event.code)) return { kind: 'remove' };

  const track = UPGRADE_KEYS.get(event.code);
  if (track) return { kind: 'upgrade', track };

  return null;
}
