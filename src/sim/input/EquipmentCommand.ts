/**
 * Garage actions as tick-stamped commands.
 *
 * The garage is a menu, but it is still driven by the same command model as
 * driving and firing: the UI emits intent, the simulation applies it on an
 * exact tick, and replaying the command stream rebuilds the same loadout.
 * Actions that cost resources therefore cannot be triggered twice by holding a
 * key, and a laggy frame cannot lose or duplicate a purchase.
 */

import type { UpgradeTrack } from '../../data/garage';

export type EquipmentAction =
  /** Moves the HUD cursor; free and always allowed. */
  | { readonly kind: 'select-slot'; readonly index: number }
  /** Fits the first affordable module of the slot's kind, or a named module. */
  | { readonly kind: 'install'; readonly moduleId?: string }
  /** Returns the module fitted in the selected slot to the locker. */
  | { readonly kind: 'remove' }
  /** Buys the next level of an upgrade track. */
  | { readonly kind: 'upgrade'; readonly track: UpgradeTrack };

export interface EquipmentCommand {
  readonly tick: number;
  readonly action: EquipmentAction;
}

export function assertValidEquipmentTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError('equipment command.tick must be a non-negative integer');
  }
}

/** Drops malformed actions instead of letting them reach the simulation. */
export function isValidEquipmentAction(action: unknown): action is EquipmentAction {
  if (typeof action !== 'object' || action === null) return false;
  const kind = (action as { kind?: unknown }).kind;
  if (kind === 'select-slot') {
    const index = (action as { index?: unknown }).index;
    return Number.isInteger(index) && (index as number) >= 0;
  }
  if (kind === 'install') {
    const moduleId = (action as { moduleId?: unknown }).moduleId;
    return moduleId === undefined || typeof moduleId === 'string';
  }
  if (kind === 'remove') return true;
  if (kind === 'upgrade') {
    const track = (action as { track?: unknown }).track;
    return track === 'engine' || track === 'chassis' || track === 'workshop';
  }
  return false;
}
