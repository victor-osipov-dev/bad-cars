/**
 * Browser save adapter.
 *
 * The only module allowed to touch IndexedDB. It converts raw driver values
 * into validated `SaveFile`s through the shared migration chain; unreadable
 * payloads are copied to a backup key instead of being silently overwritten.
 */

import type { SaveFile, SaveSlotInfo } from '../../sim/persistence/SerializedGameState';
import { migrateSaveFile, SaveMigrationError } from '../../save/migrations';
import { assertSaveSlot, describeSlot, type SaveStore } from '../../save/SaveStore';
import { validateSaveFile } from '../../save/validateSave';

const DATABASE_NAME = 'roadrage';
const DATABASE_VERSION = 1;
const STORE_NAME = 'saves';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

/** True when the environment has a usable IndexedDB implementation. */
export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export class IndexedDbSaveStore implements SaveStore {
  #database: Promise<IDBDatabase> | null = null;

  #open(): Promise<IDBDatabase> {
    if (this.#database) return this.#database;
    const opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Cannot open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab'));
    });
    this.#database = opened.catch((error: unknown): never => {
      this.#database = null;
      throw error;
    });
    return this.#database;
  }

  async list(): Promise<readonly SaveSlotInfo[]> {
    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const keys = await requestResult(store.getAllKeys());
    const values = await requestResult(store.getAll());
    await transactionDone(transaction);

    const bySlot = new Map<number, unknown>();
    keys.forEach((key, index) => {
      const match = /^slot-(\d+)$/.exec(String(key));
      if (match) bySlot.set(Number(match[1]), values[index]);
    });

    return [1, 2, 3].map((slot) => {
      const raw = bySlot.get(slot);
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
    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const raw = await requestResult(transaction.objectStore(STORE_NAME).get(`slot-${slot}`));
    await transactionDone(transaction);
    if (raw === undefined) return null;

    try {
      return migrateSaveFile(raw);
    } catch (error) {
      await this.backup(slot, raw);
      if (error instanceof SaveMigrationError) throw error;
      throw new SaveMigrationError('invalid-save', String(error));
    }
  }

  async save(slot: number, file: SaveFile): Promise<void> {
    assertSaveSlot(slot);
    const errors = validateSaveFile(file);
    if (errors.length > 0) {
      throw new SaveMigrationError('invalid-save', errors.join('; '), errors);
    }
    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(structuredClone(file), `slot-${slot}`);
    await transactionDone(transaction);
  }

  async remove(slot: number): Promise<void> {
    assertSaveSlot(slot);
    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(`slot-${slot}`);
    await transactionDone(transaction);
  }

  async backup(slot: number, raw: unknown): Promise<void> {
    assertSaveSlot(slot);
    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(structuredClone(raw), `backup-${slot}`);
    await transactionDone(transaction);
  }
}
