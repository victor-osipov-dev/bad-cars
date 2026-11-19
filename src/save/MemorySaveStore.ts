/**
 * In-memory save store.
 *
 * Used by unit tests and as a fallback when IndexedDB is blocked (private
 * browsing). It follows the same migration/backup rules as the browser
 * adapter, so tests exercise the real save path.
 */

import type { SaveFile, SaveSlotInfo } from '../sim/persistence/SerializedGameState';
import { migrateSaveFile, SaveMigrationError } from './migrations';
import { assertSaveSlot, describeSlot, type SaveStore } from './SaveStore';
import { validateSaveFile } from './validateSave';

export class MemorySaveStore implements SaveStore {
  readonly #entries = new Map<string, unknown>();

  async list(): Promise<readonly SaveSlotInfo[]> {
    return [1, 2, 3].map((slot) => {
      const raw = this.#entries.get(`slot-${slot}`);
      if (raw === undefined) return describeSlot(slot, null);
      try {
        return describeSlot(slot, migrateSaveFile(raw));
      } catch {
        return describeSlot(slot, null, true);
      }
    });
  }

  async load(slot: number): Promise<SaveFile | null> {
    assertSaveSlot(slot);
    const raw = this.#entries.get(`slot-${slot}`);
    if (raw === undefined) return null;
    try {
      return migrateSaveFile(raw);
    } catch (error) {
      await this.backup(slot, raw);
      throw error;
    }
  }

  async save(slot: number, file: SaveFile): Promise<void> {
    assertSaveSlot(slot);
    const errors = validateSaveFile(file);
    if (errors.length > 0) {
      throw new SaveMigrationError('invalid-save', errors.join('; '), errors);
    }
    this.#entries.set(`slot-${slot}`, structuredClone(file));
  }

  async remove(slot: number): Promise<void> {
    assertSaveSlot(slot);
    this.#entries.delete(`slot-${slot}`);
  }

  async backup(slot: number, raw: unknown): Promise<void> {
    assertSaveSlot(slot);
    this.#entries.set(`backup-${slot}`, structuredClone(raw));
  }

  /** Test helper: injects an untrusted payload exactly as a driver would. */
  injectRaw(slot: number, raw: unknown): void {
    assertSaveSlot(slot);
    this.#entries.set(`slot-${slot}`, structuredClone(raw));
  }

  /** Test helper: reads a backup without going through migration. */
  readBackup(slot: number): unknown {
    return this.#entries.get(`backup-${slot}`) ?? null;
  }
}
