/** Storage-agnostic contract for save slots. */

import type { SaveFile, SaveSlotInfo } from '../sim/persistence/SerializedGameState';

export interface SaveStore {
  /** Lists all menu slots, including empty and damaged ones. */
  list(): Promise<readonly SaveSlotInfo[]>;
  /** Loads and migrates a slot, or returns null when it is empty. */
  load(slot: number): Promise<SaveFile | null>;
  /** Writes a validated save file. */
  save(slot: number, file: SaveFile): Promise<void>;
  remove(slot: number): Promise<void>;
  /** Keeps an unreadable payload under a backup key for manual recovery. */
  backup(slot: number, raw: unknown): Promise<void>;
}

export function assertSaveSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    throw new RangeError('save slot must be an integer from 1 to 3');
  }
}

/** Human-readable slot caption; falls back to a damage warning. */
export function describeSlot(slot: number, file: SaveFile | null, damaged = false): SaveSlotInfo {
  if (damaged) {
    return { slot, savedAt: null, tick: null, label: 'ПОВРЕЖДЁН' };
  }
  if (!file) {
    return { slot, savedAt: null, tick: null, label: 'ПУСТО' };
  }
  const date = new Date(file.savedAt);
  const stamp = Number.isFinite(date.getTime())
    ? date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  return {
    slot,
    savedAt: file.savedAt,
    tick: file.game.tick,
    label: `${stamp} · тик ${file.game.tick}`,
  };
}
