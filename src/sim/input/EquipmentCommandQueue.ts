import {
  assertValidEquipmentTick,
  isValidEquipmentAction,
  type EquipmentAction,
  type EquipmentCommand,
} from './EquipmentCommand';

/** Hard cap on buffered garage actions; older entries are dropped first. */
const MAX_PENDING_EQUIPMENT_COMMANDS = 64;

/**
 * FIFO queue for garage actions.
 *
 * Unlike drive/aim commands, garage actions are events rather than state: a
 * queue is the right model because two upgrades in a row must both apply, and
 * there is no "current" garage action to keep active between ticks.
 */
export class EquipmentCommandQueue {
  #pending: EquipmentCommand[] = [];

  get pendingCount(): number {
    return this.#pending.length;
  }

  enqueue(command: EquipmentCommand): void {
    assertValidEquipmentTick(command.tick);
    if (!isValidEquipmentAction(command.action)) return;

    this.#pending.push({ tick: command.tick, action: command.action });
    this.#pending.sort((a, b) => a.tick - b.tick);

    if (this.#pending.length > MAX_PENDING_EQUIPMENT_COMMANDS) {
      this.#pending.splice(0, this.#pending.length - MAX_PENDING_EQUIPMENT_COMMANDS);
    }
  }

  /** Removes and returns every action due by `tick`, in order. */
  drain(tick: number): EquipmentAction[] {
    assertValidEquipmentTick(tick);
    const due: EquipmentAction[] = [];

    while (this.#pending.length > 0) {
      const next = this.#pending[0];
      if (!next || next.tick > tick) break;
      this.#pending.shift();
      due.push(next.action);
    }

    return due;
  }

  clear(): void {
    this.#pending = [];
  }
}
